# Commute Copilot

A small public dashboard for the Marysville → Bellevue commute. Every 10
minutes on weekday mornings it looks at live WSDOT traffic camera stills
along two routes, describes them with a vision model, runs the description
through TypeSafe's JEV classifier (via Vercel AI Gateway) for a calibrated
congestion score, and pushes a phone notification when things get worse.

## One-time setup after importing this repo into Vercel

1. **Storage → Marketplace Database Providers → Upstash → Redis** in the
   Vercel dashboard (Vercel KV is deprecated; Upstash Redis is the current
   replacement), and connect it to this project. This adds
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` automatically — no
   manual entry needed.
2. **Settings → Environment Variables**, add:
   - `AI_GATEWAY_API_KEY` — from Settings → AI Gateway → API Keys.
   - `NTFY_TOPIC` — make up a unique, hard-to-guess string (e.g.
     `commute-9f3a1c-marysville`). This is not a secret channel, just an
     obscure name so nobody else can guess your topic.
   - `CRON_SECRET` — any random string, protects the check endpoint from
     random public hits.
3. Install the **ntfy** app (iOS/Android) and subscribe to the same topic
   name you used for `NTFY_TOPIC`.
4. Redeploy once after adding the env vars so the cron function picks them
   up.

The dashboard itself is public at your Vercel URL (`/`) — no login. Camera
images are embedded directly from `images.wsdot.wa.gov`, so they're always
live regardless of when the last check ran; the description/severity text
below each image reflects the last scheduled check.

## Schedule

`vercel.json` runs the check every 10 minutes across two UTC hours
(13:00–14:59, i.e. 6:00–7:50 AM Pacific), weekdays only. **Vercel's Hobby
plan may restrict cron frequency to once/day** — if the 10-minute cadence
doesn't fire as configured, either upgrade to Pro or reduce this to a
single daily invocation.

## Manually triggering a check

```
curl "https://<your-app>.vercel.app/api/cron/check?secret=<CRON_SECRET>"
```
