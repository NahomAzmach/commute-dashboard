from __future__ import annotations

import asyncio
import hmac
import io
import os
from contextlib import asynccontextmanager
from typing import Annotated, Any

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from PIL import Image, ImageOps, UnidentifiedImageError
from sentence_transformers import SentenceTransformer

MODEL_ID = "google/embeddinggemma-2"
EMBEDDING_DIMENSIONS = 768
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_QUERY_LENGTH = 500
AUTH_TOKEN = os.environ.get("CAMERA_EMBEDDING_API_KEY", "")
model: SentenceTransformer | None = None
inference_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    if not AUTH_TOKEN:
        raise RuntimeError("CAMERA_EMBEDDING_API_KEY must be configured")
    model = SentenceTransformer(MODEL_ID, device="cpu")
    yield
    model = None


app = FastAPI(title="Commute Watch embedding worker", docs_url=None, redoc_url=None, lifespan=lifespan)


class TextQuery(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=MAX_QUERY_LENGTH)]


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {AUTH_TOKEN}"
    if not AUTH_TOKEN or authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def read_image(request: Request) -> Image.Image:
    image_bytes = await request.body()
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and 8 MB")
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            source.verify()
        with Image.open(io.BytesIO(image_bytes)) as source:
            return ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=400, detail="Invalid or unsupported image") from error


def make_embedding(value: Any) -> list[float]:
    if model is None:
        raise RuntimeError("Embedding model did not initialize")
    vector = np.asarray(model.encode(value, normalize_embeddings=True), dtype=np.float32)
    if vector.shape != (EMBEDDING_DIMENSIONS,) or not np.isfinite(vector).all():
        raise RuntimeError("Embedding model returned an invalid vector")
    return vector.tolist()


@app.get("/health")
async def health() -> dict[str, str | bool | int]:
    return {
        "ok": model is not None,
        "model": MODEL_ID,
        "dimensions": EMBEDDING_DIMENSIONS,
    }


@app.post("/embed/image", dependencies=[Depends(require_token)])
async def embed_image(request: Request) -> dict[str, Any]:
    image = await read_image(request)
    async with inference_lock:
        embedding = await run_in_threadpool(make_embedding, {"image": image})
    return {"model": MODEL_ID, "dimensions": EMBEDDING_DIMENSIONS, "embedding": embedding}


@app.post("/embed/text", dependencies=[Depends(require_token)])
async def embed_text(query: TextQuery) -> dict[str, Any]:
    search_query = f"task: search result | query: {query.query.strip()}"
    async with inference_lock:
        embedding = await run_in_threadpool(make_embedding, search_query)
    return {"model": MODEL_ID, "dimensions": EMBEDDING_DIMENSIONS, "embedding": embedding}
