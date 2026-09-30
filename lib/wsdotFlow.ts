import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();
const CACHE_KEY = 'wsdot:flow:v1';
// WSDOT's own flow stations update about every 90s - no point caching
// longer than that, and no point re-fetching more often either.
const CACHE_TTL_SECONDS = 90;
// Real coverage is dense on freeways (WSDOT's own stations sit within a few
// hundred feet of most highway cameras) but thinner on rural/surface roads -
// beyond this, a "nearest" match stops being a meaningful proxy for that
// specific checkpoint's actual conditions.
const MAX_DISTANCE_MILES = 0.75;

// Per WSDOT's Traffic Flow API documentation.
export const FLOW_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'WideOpen',
  2: 'Moderate',
  3: 'Heavy',
  4: 'StopAndGo',
  5: 'NoData',
};

type FlowStation = { value: number; lat: number; lon: number };

async function getFlowStations(): Promise<FlowStation[]> {
  try {
    const cached = await kv.get<FlowStation[]>(CACHE_KEY);
    if (cached && cached.length) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const accessCode = process.env.WSDOT_ACCESS_CODE;
  if (!accessCode) return [];

  try {
    const resp = await fetch(
      `https://wsdot.wa.gov/traffic/api/TrafficFlow/TrafficFlowREST.svc/GetTrafficFlowsAsJson?AccessCode=${encodeURIComponent(accessCode)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<Record<string, unknown>>;

    const stations: FlowStation[] = [];
    for (const row of rows) {
      const loc = (row?.FlowStationLocation ?? {}) as Record<string, unknown>;
      const lat = Number(loc?.Latitude);
      const lon = Number(loc?.Longitude);
      const value = Number(row?.FlowReadingValue);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(value)) continue;
      stations.push({ value, lat, lon });
    }

    void kv.set(CACHE_KEY, stations, { ex: CACHE_TTL_SECONDS }).catch(() => {});
    return stations;
  } catch {
    return [];
  }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type FlowReading = { value: number; label: string; distanceMiles: number };

/**
 * Real, independent traffic-sensor ground truth for whichever checkpoint
 * this is nearest to - WSDOT's own loop-detector network, the same data
 * their official traffic maps are built from. Unlike every other signal in
 * this pipeline (frame differencing, vehicle detection), this isn't derived
 * from the camera image at all, which makes it useful both as a genuine
 * input signal and as an independent check on how well the vision model's
 * own read actually tracks reality over time (see lib/trainingLog.ts).
 * Returns null when nothing sits close enough to be a meaningful match.
 */
export async function findNearestFlow(lat: number, lon: number): Promise<FlowReading | null> {
  const stations = await getFlowStations();
  let best: FlowStation | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const d = haversineMiles(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best || bestDist > MAX_DISTANCE_MILES) return null;
  return { value: best.value, label: FLOW_LABELS[best.value] ?? 'Unknown', distanceMiles: bestDist };
}
