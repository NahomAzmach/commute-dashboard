import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();
const LOG_KEY = 'training:log';
// Bounds how much we pull back for stats even if the log itself grows large.
const SAMPLE_CAP = 5000;

/**
 * Read-only visibility into the distillation training log (lib/trainingLog.ts).
 * No local Redis credentials exist for this project, so this is the only way
 * to check what's actually accumulating without going into the Upstash
 * console. Not sensitive data - camera IDs, timestamps, and traffic
 * condition labels, the same kind of thing /explore already surfaces.
 */
export async function GET() {
  try {
    const total = await kv.llen(LOG_KEY);
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

    // TEMPORARY: surfaces the last vehicle-detection error for production
    // debugging (see lib/vehicleDetect.ts). Remove once diagnosed.
    const lastVehicleDetectError = await kv.get<string>('debug:vehicleDetect:lastError');

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
      lastVehicleDetectError,
      newest: entries.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
