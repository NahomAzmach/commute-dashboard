import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

/**
 * Fixed-window rate limit. Fails open (allows the request) if Redis is
 * unreachable, so a storage hiccup degrades to "unprotected" rather than
 * "site broken for everyone."
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
