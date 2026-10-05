import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();
const TRAVEL_KEY = 'wsdot:traveltimes:v1';
const ALERTS_KEY = 'wsdot:alerts:v1';
const CACHE_TTL_SECONDS = 5 * 60;
const SEGMENT_MAX_MILES = 0.5;
const INCIDENT_MAX_MILES = 1;
const INCIDENT_CATEGORIES = new Set(['Collision', 'Incident', 'Closure']);

type Point = { lat: number; lon: number };
type TravelSegment = { start: Point; end: Point; currentMinutes: number; averageMinutes: number };
type Incident = { category: string; at: Point };

const TO_RAD = Math.PI / 180;

function haversineMiles(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * TO_RAD;
  const dLon = (b.lon - a.lon) * TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * TO_RAD) * Math.cos(b.lat * TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// Point-to-segment distance using a local equirectangular projection, fine at the
// few-mile scale these matches operate at.
function distanceToSegmentMiles(p: Point, a: Point, b: Point): number {
  const k = Math.cos(p.lat * TO_RAD);
  const dx = (b.lon - a.lon) * k;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (((p.lon - a.lon) * k) * dx + (p.lat - a.lat) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return haversineMiles(p, { lat: a.lat + t * dy, lon: a.lon + (t * dx) / k });
}

async function getTravelSegments(): Promise<TravelSegment[]> {
  try {
    const cached = await kv.get<TravelSegment[]>(TRAVEL_KEY);
    if (cached?.length) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const accessCode = process.env.WSDOT_ACCESS_CODE;
  if (!accessCode) return [];

  try {
    const resp = await fetch(
      `https://wsdot.wa.gov/traffic/api/TravelTimes/TravelTimesREST.svc/GetTravelTimesAsJson?AccessCode=${encodeURIComponent(accessCode)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<Record<string, any>>;
    const segments: TravelSegment[] = [];
    for (const row of rows) {
      const s = row?.StartPoint;
      const e = row?.EndPoint;
      const current = Number(row?.CurrentTime);
      const average = Number(row?.AverageTime);
      if (!s?.Latitude || !e?.Latitude || !(average > 0) || !Number.isFinite(current)) continue;
      segments.push({
        start: { lat: s.Latitude, lon: s.Longitude },
        end: { lat: e.Latitude, lon: e.Longitude },
        currentMinutes: current,
        averageMinutes: average,
      });
    }
    void kv.set(TRAVEL_KEY, segments, { ex: CACHE_TTL_SECONDS }).catch(() => {});
    return segments;
  } catch {
    return [];
  }
}

async function getIncidents(): Promise<Incident[]> {
  try {
    const cached = await kv.get<Incident[]>(ALERTS_KEY);
    if (cached) return cached;
  } catch {
    // Redis unavailable - fall through to a live fetch.
  }

  const accessCode = process.env.WSDOT_ACCESS_CODE;
  if (!accessCode) return [];

  try {
    const resp = await fetch(
      `https://wsdot.wa.gov/traffic/api/HighwayAlerts/HighwayAlertsREST.svc/GetAlertsAsJson?AccessCode=${encodeURIComponent(accessCode)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<Record<string, any>>;
    const incidents: Incident[] = [];
    for (const row of rows) {
      const loc = row?.StartRoadwayLocation;
      if (!INCIDENT_CATEGORIES.has(String(row?.EventCategory)) || row?.EventStatus === 'Closed') continue;
      if (!Number.isFinite(loc?.Latitude) || !Number.isFinite(loc?.Longitude)) continue;
      incidents.push({ category: String(row.EventCategory), at: { lat: loc.Latitude, lon: loc.Longitude } });
    }
    void kv.set(ALERTS_KEY, incidents, { ex: CACHE_TTL_SECONDS }).catch(() => {});
    return incidents;
  } catch {
    return [];
  }
}

export type TravelContext = {
  // Current travel time divided by typical travel time on the nearest segment: 1.0 is normal, above 1.0 is slower.
  travelRatio: number | null;
  // Collision, incident, or closure within a mile right now.
  incident: boolean;
};

/**
 * Independent, road-level traffic context for a camera location, from WSDOT's
 * travel-time segments and highway alerts. Logged for training labels only;
 * it does not change the live prompt or the severity score.
 */
export async function getTravelContext(lat: number, lon: number): Promise<TravelContext> {
  const p = { lat, lon };
  const [segments, incidents] = await Promise.all([getTravelSegments(), getIncidents()]);

  let best: TravelSegment | null = null;
  let bestDist = Infinity;
  for (const s of segments) {
    const d = distanceToSegmentMiles(p, s.start, s.end);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  const travelRatio =
    best && bestDist <= SEGMENT_MAX_MILES ? best.currentMinutes / best.averageMinutes : null;

  const incident = incidents.some((i) => haversineMiles(p, i.at) <= INCIDENT_MAX_MILES);
  return { travelRatio, incident };
}
