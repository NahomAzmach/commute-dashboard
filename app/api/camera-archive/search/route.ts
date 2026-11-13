import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitStrict } from '../../../../lib/ratelimit';
import { CAMERA_EMBEDDING_MODEL, embedCameraSearchText } from '../../../../lib/cameraArchiveEmbedding';
import {
  getArchivedImageUrl,
  getCameraArchiveConfig,
  supabaseRequest,
} from '../../../../lib/cameraArchiveStorage';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VALID_HOURS = new Set([1, 6, 24, 168, 720]);
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 12;

type FrameSearchRow = {
  id: number;
  camera_id: number;
  source: 'wsdot' | 'seattle';
  title: string;
  lat: number;
  lon: number;
  first_seen_at: string;
  last_seen_at: string;
  object_key: string;
  distance: number;
};

function formatVector(vector: number[]): string {
  return `[${vector.map((value) => Number(value.toFixed(5))).join(',')}]`;
}

export async function POST(req: NextRequest) {
  try {
    const forwardedFor =
      req.headers.get('x-vercel-forwarded-for') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const rateKey = createHash('sha256').update(forwardedFor).digest('hex');
    const rate = await checkRateLimitStrict(`camera-archive-search:${rateKey}`, 5, 60);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Search limit reached. Try again in a minute.' },
        { status: 429 },
      );
    }

    const body = (await req.json()) as { query?: unknown; hours?: unknown };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query || query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Enter a search phrase between 1 and ${MAX_QUERY_LENGTH} characters.` },
        { status: 400 },
      );
    }
    const requestedHours = Number(body.hours ?? 24);
    const hours = VALID_HOURS.has(requestedHours) ? requestedHours : 24;
    const vector = await embedCameraSearchText(query);
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
    const config = getCameraArchiveConfig();
    const rows = await supabaseRequest<FrameSearchRow[]>(
      config,
      'rpc/search_camera_frames',
      {
        method: 'POST',
        body: JSON.stringify({
          p_query_embedding: formatVector(vector),
          p_start_time: startTime.toISOString(),
          p_end_time: endTime.toISOString(),
          p_limit: MAX_RESULTS,
          p_model_id: CAMERA_EMBEDDING_MODEL,
        }),
      },
    );
    const results = await Promise.all(
      rows.map(async (row) => ({
        cameraId: row.camera_id,
        source: row.source,
        title: row.title,
        lat: row.lat,
        lon: row.lon,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        similarity: Math.max(0, Math.min(1, 1 - row.distance)),
        imageUrl: await getArchivedImageUrl(config.bucket, row.object_key),
      })),
    );

    return NextResponse.json(
      { query, hours, results },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Archive search failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
