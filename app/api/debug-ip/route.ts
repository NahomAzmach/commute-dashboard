import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    xForwardedFor: req.headers.get('x-forwarded-for'),
    xRealIp: req.headers.get('x-real-ip'),
    xVercelForwardedFor: req.headers.get('x-vercel-forwarded-for'),
    xVercelIpCountry: req.headers.get('x-vercel-ip-country'),
    // @ts-expect-error - present on the Node runtime in some Next versions, absent in others; that's exactly what we're checking.
    reqIp: req.ip,
  });
}
