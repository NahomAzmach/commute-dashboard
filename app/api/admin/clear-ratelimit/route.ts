import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

/**
 * One-off manual unblock for the /explore rate limit - gated by the same
 * CRON_SECRET already used for the scheduled check, not a public endpoint.
 * Exists because testing from this machine shares an IP with real site
 * usage, so my own test traffic can exhaust the real rate limit bucket.
 */
export async function GET(req: NextRequest) {
  const secretParam = req.nextUrl.searchParams.get('secret');
  const expected = process.env.CRON_SECRET;
  if (!expected || secretParam !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const ip = req.nextUrl.searchParams.get('ip');
  if (!ip) {
    return NextResponse.json({ error: 'missing ip param' }, { status: 400 });
  }

  await kv.del(`ratelimit:explore:${ip}`);
  return NextResponse.json({ ok: true, cleared: ip });
}
