import type { LatLon } from './geocode';
import type { WsdotCamera } from './wsdot';

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Approximate point-to-segment distance in km via a local equirectangular
 * projection - accurate enough at the few-km scale we filter cameras at. */
function pointToSegmentKm(p: LatLon, a: LatLon, b: LatLon): number {
  const latRef = toRad((a.lat + b.lat) / 2);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(latRef);

  const px = p.lon * kmPerDegLon;
  const py = p.lat * kmPerDegLat;
  const ax = a.lon * kmPerDegLon;
  const ay = a.lat * kmPerDegLat;
  const bx = b.lon * kmPerDegLon;
  const by = b.lat * kmPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToPolylineKm(p: LatLon, line: LatLon[]): { distanceKm: number; segmentIndex: number } {
  let best = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointToSegmentKm(p, line[i], line[i + 1]);
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }
  return { distanceKm: best, segmentIndex: bestIdx };
}

/**
 * Cameras within maxDistanceKm of the route polyline, ordered along the
 * route and capped to maxCount - sampled evenly across the match list
 * rather than just the closest N, so picks spread along the whole drive
 * instead of clustering wherever cameras happen to be densest.
 */
export function findCamerasAlongRoute(
  cameras: WsdotCamera[],
  routeLine: LatLon[],
  maxDistanceKm = 1.2,
  maxCount = 8,
): WsdotCamera[] {
  if (routeLine.length < 2) return [];

  const matches = cameras
    .map((cam) => ({ cam, ...distanceToPolylineKm(cam, routeLine) }))
    .filter((m) => m.distanceKm <= maxDistanceKm)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);

  if (matches.length <= maxCount) return matches.map((m) => m.cam);

  const step = matches.length / maxCount;
  const picked: WsdotCamera[] = [];
  for (let i = 0; i < maxCount; i++) {
    picked.push(matches[Math.floor(i * step)].cam);
  }
  return picked;
}
