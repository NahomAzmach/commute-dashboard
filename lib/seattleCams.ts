import { Redis } from '@upstash/redis';
import type { WsdotCamera } from './wsdot';

const kv = Redis.fromEnv();
const CACHE_KEY = 'seattle:catalog:v1';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

const FEATURE_SERVICE_URL =
  'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Traffic_Cameras_CDL/FeatureServer/0/query';

/**
 * Seattle DOT's own traffic camera network (~390 cameras), from the city's
 * official ArcGIS open-data feature service - a real, documented, public
 * endpoint, not a scraped or unauthorized feed. Extends /explore's coverage
 * into Seattle surface streets, which WSDOT's own catalog doesn't cover.
 *
 * The same underlying dataset also lists ~260 WSDOT-owned cameras (mirrored
 * from WSDOT's own network) - those are filtered out here since
 * lib/wsdot.ts already covers them directly from the authoritative source,
 * and double-counting the same physical camera under two IDs would just
 * confuse route matching and the training log.
 *
 * ID space is naturally separate from WSDOT's: Seattle's OBJECTIDs here run
 * ~385,000+, WSDOT's real CameraIDs top out at ~10,300 (checked directly
 * against the live catalog) - no collision risk, no offset needed.
 */
export async function getSeattleCameraCatalog(): Promise<WsdotCamera[]> {
  try {
    const cached = await kv.get<WsdotCamera[]>(CACHE_KEY);
    if (cached && cached.length) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const url =
    `${FEATURE_SERVICE_URL}?where=${encodeURIComponent("OWNERSHIP='SDOT'")}` +
    '&outFields=OBJECTID,LOCATION,NAME,URL,SERVSTAT&outSR=4326&f=json&resultRecordCount=2000';

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Seattle camera catalog fetch failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    features?: Array<{ attributes: Record<string, unknown>; geometry?: { x: number; y: number } }>;
  };

  const cameras: WsdotCamera[] = [];
  for (const f of data.features ?? []) {
    const a = f.attributes;
    if (a?.SERVSTAT !== 'ACTV') continue;

    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Washington bounding box - same sanity check as the WSDOT catalog.
    if (lat! < 45.5 || lat! > 49.05 || lon! < -124.85 || lon! > -116.9) continue;

    const rawUrl = String(a?.URL || '');
    if (!rawUrl.includes('seattle.gov/trafficcams/')) continue;
    // The feed serves both http and https for the same image - force https
    // to avoid mixed-content warnings on our own https pages.
    const imageUrl = rawUrl.replace(/^http:/, 'https:');

    const id = Number(a?.OBJECTID);
    if (!Number.isFinite(id)) continue;

    const title = String(a?.LOCATION || a?.NAME || `Seattle camera ${id}`);
    cameras.push({ id, title: `Seattle: ${title}`, lat: lat!, lon: lon!, imageUrl });
  }

  try {
    await kv.set(CACHE_KEY, cameras, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Caching is best-effort.
  }

  return cameras;
}
