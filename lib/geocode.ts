export type LatLon = { lat: number; lon: number };

export type GeocodeResult = LatLon & { displayName: string };

// Two opposite corners of Washington State as lon,lat pairs, biasing
// Nominatim's search without hard-rejecting a result just outside it.
const WA_VIEWBOX = '-124.85,49.05,-116.9,45.5';

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');
  url.searchParams.set('viewbox', WA_VIEWBOX);
  url.searchParams.set('bounded', '1');

  const resp = await fetch(url.toString(), {
    headers: {
      // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
      'User-Agent': 'commute-watch-explore/1.0 (personal project, no contact endpoint)',
    },
  });
  if (!resp.ok) throw new Error(`Geocoding failed: HTTP ${resp.status}`);
  const results = (await resp.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!results.length) return null;
  const r = results[0];
  return { lat: Number(r.lat), lon: Number(r.lon), displayName: r.display_name };
}
