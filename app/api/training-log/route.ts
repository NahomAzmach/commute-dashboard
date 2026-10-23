import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();
const LOG_KEY = 'training:log';
// Bounds how much we pull back for stats even if the log itself grows large.
const SAMPLE_CAP = 5000;

/**
 * Read-only visibility into the distillation training log (lib/trainingLog.ts).
 * Public mode returns aggregate stats only. ?export=1 with the CRON_SECRET
 * returns every raw row for offline analysis.
 */
export async function GET(req: NextRequest) {
  try {
    const total = await kv.llen(LOG_KEY);

    if (req.nextUrl.searchParams.get('export') === '1') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.nextUrl.searchParams.get('secret') !== secret) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const rows = await kv.lrange<string>(LOG_KEY, 0, total - 1);
      return NextResponse.json(rows.map((r) => (typeof r === 'string' ? JSON.parse(r) : r)));
    }

    const raw = await kv.lrange<string>(LOG_KEY, 0, Math.min(total, SAMPLE_CAP) - 1);
    const entries = raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));

    const byCondition: Record<string, number> = {};
    let withChangeSignal = 0;
    let atCeiling = 0;
    let densitySum = 0;
    let densityMin = Infinity;
    let densityMax = -Infinity;
    const cameraIds = new Set<number>();
    for (const e of entries) {
      byCondition[e.condition] = (byCondition[e.condition] ?? 0) + 1;
      if (e.change !== null && e.change !== undefined) withChangeSignal += 1;
      if (e.edgeDensity >= 1) atCeiling += 1;
      densitySum += e.edgeDensity;
      densityMin = Math.min(densityMin, e.edgeDensity);
      densityMax = Math.max(densityMax, e.edgeDensity);
      cameraIds.add(e.cameraId);
    }

    return NextResponse.json({
      totalLogged: total,
      sampledForStats: entries.length,
      uniqueCameras: cameraIds.size,
      byCondition,
      withChangeSignal,
      edgeDensityStats: {
        atCeiling,
        avg: entries.length ? densitySum / entries.length : null,
        min: entries.length ? densityMin : null,
        max: entries.length ? densityMax : null,
      },
      newest: entries.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
