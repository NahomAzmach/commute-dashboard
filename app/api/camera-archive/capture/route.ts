import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { captureSelectedCamera } from '../../../../lib/cameraArchiveCapture';
import { checkRateLimitStrict } from '../../../../lib/ratelimit';

export const runtime = 'nodejs';
export const maxDuration = 180;

const CaptureInput = z
  .object({
    cameraId: z.number().int().positive(),
    source: z.enum(['wsdot', 'seattle']),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const forwardedFor =
      req.headers.get('x-vercel-forwarded-for') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const rateKey = createHash('sha256').update(forwardedFor).digest('hex');
    const rate = await checkRateLimitStrict(`camera-archive-capture:${rateKey}`, 5, 60);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Capture limit reached. Try again in a minute.' },
        { status: 429 },
      );
    }

    const input = CaptureInput.parse(await req.json());
    const result = await captureSelectedCamera(input.cameraId, input.source);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
