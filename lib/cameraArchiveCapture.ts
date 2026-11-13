import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getSeattleCameraCatalog } from './seattleCams';
import { getWsdotCatalog, type WsdotCamera } from './wsdot';
import { embedCameraImage, CAMERA_EMBEDDING_MODEL } from './cameraArchiveEmbedding';
import {
  deleteArchivedImage,
  getCameraArchiveConfig,
  putArchivedImage,
  supabaseRequest,
} from './cameraArchiveStorage';

const ARCHIVE_PREFIX = 'camera-archive';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 960;
const DEDUPE_HAMMING_DISTANCE = 1;
const DEDUPE_GAP_MS = 10 * 60 * 1000;

export type CameraSource = 'wsdot' | 'seattle';
type ArchiveCamera = WsdotCamera & { source: CameraSource };

type SignatureRow = {
  signature: string;
  frame_id: number;
  last_seen_at: string;
};

function formatVector(vector: number[]): string {
  return `[${vector.map((value) => Number(value.toFixed(5))).join(',')}]`;
}

async function compressImage(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({
      width: MAX_IMAGE_WIDTH,
      height: MAX_IMAGE_WIDTH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 68, mozjpeg: true })
    .toBuffer();
}

async function differenceHash(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = '';
  let nibble = 0;
  let nibbleBits = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      nibble = (nibble << 1) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1 : 0);
      nibbleBits++;
      if (nibbleBits === 4) {
        hash += nibble.toString(16);
        nibble = 0;
        nibbleBits = 0;
      }
    }
  }
  return hash;
}

function hammingDistance(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let bits = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (bits) {
      count++;
      bits &= bits - 1;
    }
  }
  return count + Math.abs(a.length - b.length) * 4;
}

async function findCamera(cameraId: number, source: CameraSource): Promise<ArchiveCamera> {
  const cameras =
    source === 'wsdot' ? await getWsdotCatalog() : await getSeattleCameraCatalog();
  const camera = cameras.find((candidate) => candidate.id === cameraId);
  if (!camera) throw new Error(`Camera ${cameraId} was not found in the ${source} catalog`);
  return { ...camera, source };
}

async function getLatestSignature(
  cameraId: number,
  source: CameraSource,
): Promise<SignatureRow | null> {
  const config = getCameraArchiveConfig();
  const rows = await supabaseRequest<SignatureRow[]>(
    config,
    `camera_frame_signatures?camera_id=eq.${cameraId}&source=eq.${source}&select=signature,frame_id,last_seen_at&limit=1`,
  );
  return rows[0] ?? null;
}

async function updateLastSeen(
  cameraId: number,
  source: CameraSource,
  frameId: number,
  capturedAt: string,
): Promise<void> {
  const config = getCameraArchiveConfig();
  await Promise.all([
    supabaseRequest(config, `camera_frames?id=eq.${frameId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen_at: capturedAt }),
    }),
    supabaseRequest(
      config,
      `camera_frame_signatures?camera_id=eq.${cameraId}&source=eq.${source}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen_at: capturedAt }),
      },
    ),
  ]);
}

async function saveFrame(camera: ArchiveCamera): Promise<{
  outcome: 'stored' | 'duplicate';
  capturedAt: string;
  title: string;
}> {
  const config = getCameraArchiveConfig();
  const capturedAt = new Date();
  const timestamp = capturedAt.toISOString();
  const response = await fetch(camera.imageUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Camera image fetch failed with HTTP ${response.status}`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Camera returned non-image content (${contentType || 'unknown content type'})`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('Camera image exceeds the 8 MB size limit');
  const sourceBytes = Buffer.from(await response.arrayBuffer());
  if (sourceBytes.length === 0 || sourceBytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Camera image is empty or exceeds the 8 MB size limit');
  }

  const image = await compressImage(sourceBytes);
  const signature = await differenceHash(image);
  const latest = await getLatestSignature(camera.id, camera.source);
  const elapsed = latest ? capturedAt.getTime() - new Date(latest.last_seen_at).getTime() : Infinity;
  if (
    latest &&
    elapsed >= 0 &&
    elapsed <= DEDUPE_GAP_MS &&
    hammingDistance(signature, latest.signature) <= DEDUPE_HAMMING_DISTANCE
  ) {
    await updateLastSeen(camera.id, camera.source, latest.frame_id, timestamp);
    return { outcome: 'duplicate', capturedAt: timestamp, title: camera.title };
  }

  const embedding = await embedCameraImage(image);
  const imageHash = createHash('sha256').update(image).digest('hex');
  const keyTime = timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const objectKey =
    `${ARCHIVE_PREFIX}/${camera.source}/${camera.id}/` +
    `${keyTime}-${imageHash.slice(0, 12)}.jpg`;
  await putArchivedImage(config.bucket, objectKey, image);

  let inserted: { id: number }[];
  try {
    inserted = await supabaseRequest<{ id: number }[]>(config, 'camera_frames?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        camera_id: camera.id,
        source: camera.source,
        title: camera.title,
        lat: camera.lat,
        lon: camera.lon,
        first_seen_at: timestamp,
        last_seen_at: timestamp,
        object_key: objectKey,
        embedding_model: CAMERA_EMBEDDING_MODEL,
        embedding: formatVector(embedding),
      }),
    });
  } catch (error) {
    await deleteArchivedImage(config.bucket, objectKey);
    throw error;
  }
  const frameId = inserted[0]?.id;
  if (!frameId) {
    await deleteArchivedImage(config.bucket, objectKey);
    throw new Error('Supabase did not return the saved frame ID');
  }

  try {
    await supabaseRequest(
      config,
      'camera_frame_signatures?on_conflict=source,camera_id',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          camera_id: camera.id,
          source: camera.source,
          signature,
          frame_id: frameId,
          last_seen_at: timestamp,
        }),
      },
    );
  } catch (error) {
    throw new Error(
      `Image saved, but its duplicate-detection record failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { outcome: 'stored', capturedAt: timestamp, title: camera.title };
}

export async function captureSelectedCamera(cameraId: number, source: CameraSource) {
  const camera = await findCamera(cameraId, source);
  return saveFrame(camera);
}
