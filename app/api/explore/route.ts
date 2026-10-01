import { NextRequest, NextResponse } from 'next/server';
import { geocode } from '../../../lib/geocode';
import { getDrivingRoute } from '../../../lib/routing';
import { getWsdotCatalog } from '../../../lib/wsdot';
import { getSeattleCameraCatalog } from '../../../lib/seattleCams';
import { findCamerasAlongRoute } from '../../../lib/geometry';
import { runLiveCheck } from '../../../lib/liveCheck';
import { checkRateLimit } from '../../../lib/ratelimit';

export const maxDuration = 60;

const MAX_SCANS_PER_WINDOW = 5;
const WINDOW_SECONDS = 600;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const rl = await checkRateLimit(`ratelimit:explore:${ip}`, MAX_SCANS_PER_WINDOW, WINDOW_SECONDS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many scans from this address - try again in a few minutes.` },
      { status: 429 },
    );
  }

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const fromQuery = (body.from || '').trim();
  const toQuery = (body.to || '').trim();
  if (!fromQuery || !toQuery) {
    return NextResponse.json({ error: 'Both a start and end location are required' }, { status: 400 });
  }

  try {
    const [from, to] = await Promise.all([geocode(fromQuery), geocode(toQuery)]);
    if (!from) {
      return NextResponse.json({ error: `Couldn't find "${fromQuery}" in Washington State` }, { status: 400 });
    }
    if (!to) {
      return NextResponse.json({ error: `Couldn't find "${toQuery}" in Washington State` }, { status: 400 });
    }

    const routeLine = await getDrivingRoute(from, to);
    // Seattle's catalog is a newer, secondary addition - a hiccup there
    // shouldn't take down /explore for routes that don't even touch Seattle.
    const [wsdotCameras, seattleCameras] = await Promise.all([
      getWsdotCatalog(),
      getSeattleCameraCatalog().catch(() => []),
    ]);
    const catalog = [...wsdotCameras, ...seattleCameras];
    const nearby = findCamerasAlongRoute(catalog, routeLine, 1.2, 8);

    if (!nearby.length) {
      return NextResponse.json(
        {
          error:
            'No traffic cameras found within about a mile of that route. Try a route that follows a state highway, interstate, or Seattle street.',
        },
        { status: 404 },
      );
    }

    const result = await runLiveCheck('explore', `${fromQuery} → ${toQuery}`, nearby);

    return NextResponse.json({
      ok: true,
      route: result,
      routeLine: routeLine.map((p) => [p.lat, p.lon]),
      from: { lat: from.lat, lon: from.lon, label: fromQuery },
      to: { lat: to.lat, lon: to.lon, label: toQuery },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
