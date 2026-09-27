# Commute Copilot

A small public dashboard for the Marysville → Bellevue commute. Every 10
minutes on weekday mornings it looks at live WSDOT traffic camera stills
along two routes, describes them with a vision model, runs the description
through TypeSafe's JEV classifier (via Vercel AI Gateway) for a calibrated
congestion score, and pushes a phone notification when things get worse.

Scheduling runs on GitHub Actions, not Vercel Cron — Vercel's Hobby plan
caps cron jobs at once/day (and will refuse to deploy a project whose
`vercel.json` declares a tighter schedule), so the check endpoint is just a
plain authenticated API route that anything can call on a schedule.

## One-time setup

### 1. Deploy to Vercel

Import this repo into Vercel (Add New → Project). It should deploy cleanly
now that there's no `vercel.json` cron declaration.

1. **Storage → Marketplace Database Providers → Upstash → Redis**, connect
   it to this project. Adds `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` automatically.
2. **Settings → Environment Variables**, add:
   - `AI_GATEWAY_API_KEY` — from Settings → AI Gateway → API Keys.
   - `NTFY_TOPIC` — a unique, hard-to-guess string (e.g.
     `commute-9f3a1c-marysville`). Not a real secret, just obscure enough
     that nobody else guesses your topic.
   - `CRON_SECRET` — any random string, protects the check endpoint from
     random public hits.
3. Redeploy once after adding the env vars.
4. Note the production URL Vercel gives you (Project → Deployments, or the
   domain shown on the project overview).

### 2. Wire up the schedule (GitHub Actions)

The workflow at `.github/workflows/commute-check.yml` is already in this
repo. It just needs two repository secrets:

```
gh secret set DASHBOARD_URL --body "https://<your-vercel-domain>"
gh secret set CRON_SECRET --body "<the same value you set in Vercel>"
```

(Or add them via GitHub → repo → Settings → Secrets and variables →
Actions, if you'd rather use the web UI.)

It fires every 10 minutes, 6:00–7:50 AM Pacific, weekdays only. You can
also trigger it on demand from the Actions tab ("Run workflow") or with:

```
gh workflow run commute-check.yml
```

### 3. Get notified

Install the **ntfy** app (iOS/Android) and subscribe to the topic name you
used for `NTFY_TOPIC`.

## The dashboard

Public at your Vercel URL (`/`) — no login. Camera images are embedded
directly from `images.wsdot.wa.gov`, so they're always live regardless of
when the last check ran; the description/severity text below each image
reflects the last scheduled check.

## Manually triggering a check

```
curl "https://<your-app>.vercel.app/api/cron/check?secret=<CRON_SECRET>"
```
