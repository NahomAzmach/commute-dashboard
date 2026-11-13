const EMBEDDING_MODEL = 'google/embeddinggemma-2';
const EMBEDDING_DIMENSIONS = 768;

type EmbeddingResponse = {
  model: string;
  dimensions: number;
  embedding: number[];
};

function getEmbeddingConfig(): { url: string; token: string } {
  const url = process.env.CAMERA_EMBEDDING_URL?.replace(/\/+$/, '');
  const token = process.env.CAMERA_EMBEDDING_API_KEY;
  if (!url || !token) {
    throw new Error(
      'Embedding worker is not configured. Start the local EmbeddingGemma worker and set CAMERA_EMBEDDING_URL and CAMERA_EMBEDDING_API_KEY.',
    );
  }
  return { url, token };
}

async function requestEmbedding(
  path: string,
  body: BodyInit,
  contentType: string,
): Promise<number[]> {
  const config = getEmbeddingConfig();
  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': contentType,
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Embedding worker failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as EmbeddingResponse;
  if (
    data.model !== EMBEDDING_MODEL ||
    data.dimensions !== EMBEDDING_DIMENSIONS ||
    !Array.isArray(data.embedding) ||
    data.embedding.length !== EMBEDDING_DIMENSIONS ||
    data.embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Embedding worker returned an incompatible vector');
  }
  return data.embedding;
}

export function embedCameraImage(bytes: Uint8Array): Promise<number[]> {
  return requestEmbedding('/embed/image', Buffer.from(bytes), 'image/jpeg');
}

export function embedCameraSearchText(query: string): Promise<number[]> {
  return requestEmbedding(
    '/embed/text',
    JSON.stringify({ query }),
    'application/json',
  );
}

export const CAMERA_EMBEDDING_MODEL = EMBEDDING_MODEL;
