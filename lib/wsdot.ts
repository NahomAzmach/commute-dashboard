import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();
const CACHE_KEY = 'wsdot:catalog:v2';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

export type WsdotCamera = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
};

/**
 * The full statewide WSDOT camera catalog (~1,700 cameras), cached in Redis
 * since it rarely changes and the raw fetch is a multi-megabyte payload.
 */
export async function getWsdotCatalog(): Promise<WsdotCamera[]> {
  try {
    const cached = await kv.get<WsdotCamera[]>(CACHE_KEY);
    if (cached && cached.length) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const accessCode = process.env.WSDOT_ACCESS_CODE;
  if (!accessCode) throw new Error('WSDOT_ACCESS_CODE is not configured');

  const resp = await fetch(
    `https://wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${encodeURIComponent(accessCode)}`,
  );
  if (!resp.ok) throw new Error(`WSDOT catalog fetch failed: HTTP ${resp.status}`);
  const rows = (await resp.json()) as Array<Record<string, unknown>>;

  const cameras: WsdotCamera[] = [];
  for (const row of rows) {
    if (row?.IsActive === false) continue;
    const loc = (row?.CameraLocation ?? {}) as Record<string, unknown>;
    const lat = Number(row?.DisplayLatitude ?? loc?.Latitude);
    const lon = Number(row?.DisplayLongitude ?? loc?.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Washington bounding box - a bad upstream coord can't place a camera out of state.
    if (lat < 45.5 || lat > 49.05 || lon < -124.85 || lon > -116.9) continue;

    const imageUrl = String(row?.ImageURL || '');
    if (!imageUrl.startsWith('https://images.wsdot.wa.gov/')) continue;

    const id = Number(row?.CameraID);
    if (!Number.isFinite(id)) continue;

    const title = String(row?.Title || row?.Description || `WSDOT ${id}`);
    if (isNonMainlineCamera(title)) continue;
    cameras.push({ id, title, lat, lon, imageUrl });
  }

  try {
    await kv.set(CACHE_KEY, cameras, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Caching is best-effort.
  }

  return cameras;
}

// Ferry terminals, weigh stations, and rest areas show up in the same
// catalog and sit right next to highways, so geometry matching alone picks
// them up - but "empty holding lot" or "no queue at a weigh station" reads
// as very different conditions than actual moving-lane traffic, and gets
// misread as congestion or dismissed as unreadable rather than reflecting
// the road itself. Filtered out entirely rather than fed to the model.
const NON_MAINLINE_KEYWORDS = ['ferry', 'holding', 'weigh station', 'rest area', 'wsf '];

function isNonMainlineCamera(title: string): boolean {
  const lower = title.toLowerCase();
  return NON_MAINLINE_KEYWORDS.some((kw) => lower.includes(kw));
}
