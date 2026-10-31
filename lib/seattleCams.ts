import { Redis } from '@upstash/redis';
import type { WsdotCamera } from './wsdot';

const kv = Redis.fromEnv();
const CACHE_KEY = 'seattle:catalog:v2';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

const FEATURE_LAYER_URL =
  'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Traffic_Cameras/FeatureServer/0/query';
const CAMERA_DIRECTORY_URL =
  'https://web.seattle.gov/Travelers/api/Map/GetCamerasByNeighborhood?neighborhood=All';
const CAMERA_IMAGE_ROOT = 'https://www.seattle.gov/trafficcams/images/';
const CAMERA_ID_OFFSET = 1_000_000;

type SeattleFeature = {
  attributes?: {
    OBJECTID?: unknown;
    UNITID?: unknown;
    LOCATION?: unknown;
    SERVSTAT?: unknown;
  };
  geometry?: { x?: number; y?: number };
};

type SeattleCameraImage = {
  Id?: unknown;
  Description?: unknown;
  ImageUrl?: unknown;
  Type?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchCameraFeatures(): Promise<SeattleFeature[]> {
  const params = new URLSearchParams({
    where: "OWNERSHIP='SDOT' AND SERVSTAT='ACTV'",
    outFields: 'OBJECTID,UNITID,LOCATION,SERVSTAT',
    outSR: '4326',
    f: 'json',
    resultRecordCount: '1000',
  });
  const resp = await fetch(`${FEATURE_LAYER_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Seattle camera catalog failed: HTTP ${resp.status}`);

  const data: unknown = await resp.json();
  if (!isRecord(data)) throw new Error('Seattle camera catalog returned an invalid response');
  if (isRecord(data.error)) {
    const message = typeof data.error.message === 'string' ? data.error.message : 'unknown error';
    throw new Error(`Seattle camera catalog failed: ${message}`);
  }
  if (!Array.isArray(data.features)) {
    throw new Error('Seattle camera catalog response is missing camera features');
  }
  return data.features as SeattleFeature[];
}

async function fetchCameraImages(): Promise<SeattleCameraImage[]> {
  const resp = await fetch(CAMERA_DIRECTORY_URL, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Seattle camera image directory failed: HTTP ${resp.status}`);

  let data: unknown = await resp.json();
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      throw new Error('Seattle camera image directory returned invalid JSON');
    }
  }
  if (!Array.isArray(data)) {
    throw new Error('Seattle camera image directory response is not a camera list');
  }
  return data as SeattleCameraImage[];
}

/**
 * Seattle's official GIS layer provides active camera locations and stable
 * UNITIDs. The city's official Traveler API provides current image names.
 */
export async function getSeattleCameraCatalog(): Promise<WsdotCamera[]> {
  try {
    const cached = await kv.get<WsdotCamera[]>(CACHE_KEY);
    if (cached?.length) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const [features, imageRows] = await Promise.all([fetchCameraFeatures(), fetchCameraImages()]);
  const imageByUnitId = new Map<string, SeattleCameraImage>();
  for (const camera of imageRows) {
    if (camera.Type !== 'sdot' || typeof camera.Id !== 'string') continue;
    imageByUnitId.set(camera.Id, camera);
  }

  const cameras: WsdotCamera[] = [];
  for (const feature of features) {
    const attributes = feature.attributes;
    const objectId = Number(attributes?.OBJECTID);
    const unitId = String(attributes?.UNITID ?? '');
    const lat = feature.geometry?.y;
    const lon = feature.geometry?.x;
    if (
      !Number.isFinite(objectId) ||
      !unitId ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      continue;
    }
    const image = imageByUnitId.get(unitId);
    const imageName = typeof image?.ImageUrl === 'string' ? image.ImageUrl : '';
    if (!/^[\w.-]+\.jpe?g$/i.test(imageName)) continue;

    cameras.push({
      id: CAMERA_ID_OFFSET + objectId,
      title: `Seattle: ${String(attributes?.LOCATION ?? image?.Description ?? unitId)}`,
      lat: lat!,
      lon: lon!,
      imageUrl: `${CAMERA_IMAGE_ROOT}${encodeURIComponent(imageName)}`,
    });
  }

  if (features.length > 0 && cameras.length === 0) {
    throw new Error('No active Seattle cameras matched the official live image directory');
  }

  try {
    await kv.set(CACHE_KEY, cameras, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Caching is best-effort.
  }

  return cameras;
}
