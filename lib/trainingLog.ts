import { Redis } from '@upstash/redis';
import type { Condition } from './ai';

const kv = Redis.fromEnv();

const LOG_KEY = 'training:log';
// Bounds storage cost - a rolling window of the most recent labels rather
// than an ever-growing history. At ~15 checkpoints/check and a check every
// few minutes, this comfortably spans several days before anything drops off.
const MAX_ENTRIES = 20000;

export type TrainingExample = {
  cameraId: number;
  timestamp: number;
  hour: number;
  change: number | null;
  edgeDensity: number;
  condition: Condition;
};

/**
 * Appends one labeled example - the engineered features a small model would
 * train on, plus the condition Gemini already assigned - to a rolling log.
 * This is the raw material for distillation (see lib/ai.ts): once enough of
 * these accumulate, a cheap classifier can be trained offline on
 * (change, edgeDensity, hour, cameraId) -> condition and used to skip the
 * real API call on easy cases.
 *
 * Best-effort and fire-and-forget - a missed log entry just means one fewer
 * training example, never a reason to fail or slow down a live check.
 */
export async function logExample(example: TrainingExample): Promise<void> {
  try {
    await kv.lpush(LOG_KEY, JSON.stringify(example));
    await kv.ltrim(LOG_KEY, 0, MAX_ENTRIES - 1);
  } catch {
    // Logging is best-effort - never let this affect a live check.
  }
}
