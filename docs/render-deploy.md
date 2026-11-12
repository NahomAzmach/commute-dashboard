# Deploying Commute Watch to Render

The repo includes a Render Blueprint for a free Node.js web service. It
deploys the current GitHub branch; uncommitted local changes are not included.
The experimental camera archive is intentionally not part of this deployment.

## Create the service

1. Sign in to Render and choose **New -> Blueprint**.
2. Connect `NahomAzmach/commute-dashboard` and select the `master` branch.
3. Review `render.yaml` and create the service.
4. When prompted, enter the existing server-side values for
   `AI_GATEWAY_API_KEY`, `CRON_SECRET`, `WSDOT_ACCESS_CODE`,
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `NTFY_TOPIC`.
   Copy them from the provider dashboards; do not commit them to Git.
5. Wait for the first build and check the service logs and health status.
   Verify `/commute`, `/cameras`, `/api/training-log`, and one authenticated
   scheduled check before changing any scheduler destination.

## Resume scheduled checks

After the Render URL is live and a manual authenticated check succeeds, update
the existing Upstash QStash schedules to call the Render host instead of the
paused Vercel host. Keep their existing cadence and authorization settings.
Do not create duplicate schedules.

Render's Free web service has limited CPU and memory, spins down after a period
without inbound traffic, and has an ephemeral filesystem. This app uses native
ONNX inference and several external camera/API requests per scheduled check,
so monitor logs and Render's included usage closely. If it runs out of memory
or is suspended for outbound traffic, reduce check frequency and checkpoint
work before considering another host. The Redis-backed commute state survives
service restarts; files written locally would not.
