import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const key = `ratelimit:explore:${ip}`;
  const [count, ttl] = await Promise.all([kv.get(key), kv.ttl(key)]);
  return NextResponse.json({ ip, key, count, ttlSecondsRemaining: ttl });
}
