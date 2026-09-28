import type { LatLon } from './geocode';

/**
 * Driving route polyline between two points via OSRM's public demo router.
 * Free and keyless, but it's a shared community instance meant for demos -
 * fine at this scale, not something to depend on for real production load.
 */
export async function getDrivingRoute(from: LatLon, to: LatLon): Promise<LatLon[]> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Routing failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    routes?: Array<{ geometry: { coordinates: [number, number][] } }>;
  };
  const route = data.routes?.[0];
  if (!route) throw new Error('No driving route found between those points');
  return route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
}
