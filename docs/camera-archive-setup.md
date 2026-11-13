# Selected-camera semantic archive

The archive saves a still only after you select a WSDOT or Seattle DOT camera
on **All Cameras** and press **SAVE AND INDEX THIS MOMENT**. It does not poll
or sample other cameras. Lynnwood live-camera markers keep their existing
player behavior and are not part of this archive.

Each saved still is compressed and stored in a private Cloudflare R2 bucket.
Supabase stores its timestamp, camera metadata, duplicate-detection signature,
and 768-dimensional EmbeddingGemma 2 vector. Natural-language search embeds
the query with the same model and searches saved images within the selected
time window. Search cannot find moments that were never saved.

## Configure storage

1. Create a private R2 bucket and an API token restricted to that bucket with
   object read/write permissions.
2. Add an R2 lifecycle rule that expires objects under the
   `camera-archive/` prefix after 30 days.
3. In the Supabase SQL Editor, run
   [`supabase/migrations/20261102000000_camera_archive.sql`](../supabase/migrations/20261102000000_camera_archive.sql).
   It creates private tables, a pgvector search function, and daily removal of
   records older than 30 days. The R2 lifecycle rule independently expires the
   associated image objects.
4. Set the R2 and Supabase server-only variables listed in `.env.example`.
   The Supabase service-role key and R2 credentials must never use a
   `NEXT_PUBLIC_` prefix or be exposed to the browser.
5. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from a
   Redis database for the Next.js server. The save and search endpoints apply
   strict per-IP rate limits and return an error if Redis is unavailable.

## Run the local embedding worker

The worker loads Google's ungated `google/embeddinggemma-2` model on CPU. The
model download is several gigabytes and the first startup can take a while.
Python 3.11 is recommended for this pilot. The image extra installs
Torchvision, which the model's multimodal processor requires.

From the repository root in PowerShell:

```powershell
py -3.11 -m venv services\embedding-worker\.venv
services\embedding-worker\.venv\Scripts\python.exe -m pip install -r services\embedding-worker\requirements.txt
$line = Get-Content .env.local | Where-Object { $_ -match '^\s*CAMERA_EMBEDDING_API_KEY\s*=' } | Select-Object -Last 1
if (-not $line) { throw "CAMERA_EMBEDDING_API_KEY is missing from .env.local" }
$env:CAMERA_EMBEDDING_API_KEY = (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
if (-not $env:CAMERA_EMBEDDING_API_KEY) { throw "CAMERA_EMBEDDING_API_KEY is empty in .env.local" }
$env:HF_HOME = "$HOME\.cache\huggingface"
services\embedding-worker\.venv\Scripts\python.exe -m uvicorn main:app --app-dir services\embedding-worker --host 127.0.0.1 --port 8790
```

In the Next.js server's environment, set `CAMERA_EMBEDDING_URL` to
`http://127.0.0.1:8790` and `CAMERA_EMBEDDING_API_KEY` to the same secret.
Restart the Next.js server after setting environment variables. The worker
binds only to localhost; do not expose it directly to the public internet.
`/health` reports whether model loading finished.

## Local versus Render

The local worker and Next.js server can communicate over `127.0.0.1` when both
run on the same computer. A Next.js service hosted on Render cannot reach the
worker at your computer's `127.0.0.1`. Therefore the indexing and semantic
search actions will not work on the Render deployment with the local URL.
For this first pilot, run the web app locally as well. If you later want the
Render-hosted app to use your local worker, first set up a private,
authenticated HTTPS tunnel and configure its URL and the matching token;
never expose the worker unauthenticated.

## Use and validate

1. Start the embedding worker and the Next.js app, and configure R2 and
   Supabase.
2. Open **All Cameras**, select a WSDOT or Seattle DOT dot, then choose
   **SAVE AND INDEX THIS MOMENT**. Only that camera is fetched and embedded.
3. After at least one successful save, use the natural-language search panel.
   Search results include matching saved frames, camera details, timestamps,
   and similarity.

Repeated nearly identical frames from the same camera within ten minutes
update the saved frame's last-seen time instead of storing another image.
The first save starts the archive; live feeds do not provide historical
backfill.
