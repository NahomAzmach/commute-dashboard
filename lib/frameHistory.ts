import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

const KEY_PREFIX = 'frame:sig:';
// Long enough to span a slow visitor gap on /explore, short enough that a
// comparison never spans an entire day/night cycle by accident.
const TTL_SECONDS = 2 * 60 * 60;

/**
 * Previous frame signature for a camera, shared across every caller
 * (scheduled personal checks and any /explore visitor) - whichever request
 * saw this camera most recently, within the TTL window, becomes the
 * baseline for the next one.
 */
export async function getPreviousSignature(cameraId: number): Promise<Buffer | null> {
  try {
    const raw = await kv.get<string>(KEY_PREFIX + cameraId);
    if (!raw) return null;
    return Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
}

export async function setSignature(cameraId: number, signature: Buffer): Promise<void> {
  try {
    await kv.set(KEY_PREFIX + cameraId, signature.toString('base64'), { ex: TTL_SECONDS });
  } catch {
    // Best-effort - a failed write just means no baseline for next time.
  }
}
