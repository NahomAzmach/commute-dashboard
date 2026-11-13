import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type CameraArchiveConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  bucket: string;
};

let client: S3Client | null = null;

export function getCameraArchiveConfig(): CameraArchiveConfig {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !accountId && 'R2_ACCOUNT_ID',
    !accessKeyId && 'R2_ACCESS_KEY_ID',
    !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
    !bucket && 'R2_BUCKET_NAME',
    !supabaseUrl && 'SUPABASE_URL',
    !supabaseServiceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Camera archive is not configured; missing ${missing.join(', ')}`);
  }

  return {
    supabaseUrl: supabaseUrl!.replace(/\/+$/, ''),
    supabaseServiceRoleKey: supabaseServiceRoleKey!,
    bucket: bucket!,
  };
}

function getR2Client(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are not configured');
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export async function putArchivedImage(
  bucket: string,
  key: string,
  bytes: Buffer,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: 'image/jpeg',
      CacheControl: 'private, max-age=600, immutable',
    }),
  );
}

export async function deleteArchivedImage(bucket: string, key: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function getArchivedImageUrl(bucket: string, key: string): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: 600 },
  );
}

export async function supabaseRequest<T>(
  config: CameraArchiveConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}
