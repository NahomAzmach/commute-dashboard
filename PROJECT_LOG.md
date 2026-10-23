# Commute Dashboard — Project Log

Running record of what was built, why, and what was learned — kept for a
later write-up. Updated after each change; entries get corrected or removed
if a later finding supersedes them, so this should always reflect the
current, accurate state of the project rather than a raw chronological diary.

## Origin

Started from [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)
(a live public-camera viewer) — added WSDOT traffic cameras for a personal
commute (Marysville → Bellevue), then automated the "should I leave now"
decision instead of checking manually.

## V1: JEV classifier (removed)

A small, cheap vision classifier (JEV) scored each camera still for a
yes/no/severity read. Dropped because the underlying vision model it scored
was unreliable — it kept returning "too dark to determine conditions" on
otherwise-readable images, so JEV was confidently scoring garbage input.
Not a JEV bug; a garbage-in problem upstream.

## V2: Single-call Gemini 2.5 Flash-Lite (current)

Replaced JEV with one call per route: every checkpoint image goes to
`google/gemini-2.5-flash-lite` at once, classified into five fixed
categories (`clear/slow/congested/stopped/unreadable`), and the route
severity score is computed in plain code from those categories — not asked
of the model as a free-form number. Forcing fixed categories per image was
far more repeatable than asking the model to eyeball a whole route's
severity. Verified deterministic at temperature 0 (froze real images to
fixed bytes, ran 8x, identical output every time).

Cost: ~$0.0003/check.

### Reliability fixes on top of V2
- Distinguished a vehicle stopped at a red light/stop sign from real
  congestion (was being misclassified as "stopped").
- Filtered ferry/weigh-station/rest-area cameras out of the WSDOT catalog —
  an empty holding lot was reading as congestion or confusing the model.
- Per-checkpoint map dot coloring (was one color for the whole route,
  hiding which specific camera was bad).

## Grounding the model in real signals ("Building 1/2/3" plan)

Goal: reduce reliance on the vision model's own guesses by feeding it (and
eventually a distilled small model) real, cheaply-computed signals instead.

**Shipped:**
- **Frame differencing** (`lib/visualSignals.ts`, `lib/frameHistory.ts`) —
  pixel-level diff against the last time anyone checked that camera. Real,
  deterministic motion signal instead of the model inventing "motion blur"
  in a single still frame.
- **Vehicle detection** (`lib/vehicleDetect.ts`) — pretrained YOLOv8n,
  zero training data needed. **Deployment dead end, documented for the
  record:** first built on `onnxruntime-web`'s wasm backend specifically to
  avoid native-binary risk — worked perfectly locally, but its internal
  dynamic module loading was not traceable by Next.js's serverless file
  tracer (confirmed in production with `ERR_MODULE_NOT_FOUND`, not just
  suspected; tried explicit path includes, brace globs, star globs, a
  literal dynamic import in our own code — none worked). Switched to
  `onnxruntime-node` (native binary) instead, which is actually Microsoft's
  own recommended path for Node.js server-side inference. Validated against
  a reference PyTorch run on real WSDOT images before shipping.
- **WSDOT road-sensor signal** (`lib/wsdotFlow.ts`) — real loop-detector
  readings (WideOpen/Moderate/Heavy/StopAndGo), independent of the camera
  image entirely. All 11 original commute cameras sit within 0.4mi of a
  station. Shown as a visible "Sensor: ___" badge in the UI, not just a
  backend signal.

**Tried and rejected:**
- **Edge-density "how busy is this frame" proxy** — dropped after real
  calibration testing: absolute edge energy is dominated by each camera's
  static background (guardrails, trees), not vehicles. An empty road with
  scenery can out-score a busy one with a plain background. Kept in
  `lib/visualSignals.ts`, documented, not used in the live prompt — still
  logged as a raw training feature in case a per-camera relative baseline
  is worth building later.

## Coverage expansion

- **Seattle DOT cameras** (`lib/seattleCams.ts`) — real, documented,
  official ArcGIS open-data feature service. ~390 cameras after filtering
  out the ~260 WSDOT-owned cameras the same dataset also mirrors (avoids
  double-counting the same physical camera under two IDs).
- **Lynnwood cameras — investigated, declined.** These run through Dacast,
  a paid per-camera-licensed commercial video platform, not a free public
  API. Found (via the city's own leaked internal debug notes) that at least
  one camera has been offline since Dec 2024 over a licensing dispute.
  Declined to embed these on the live dashboard: doing so would route
  arbitrary visitor traffic through the city's paid account without
  verifiable authorization. Not implemented.
- **Browse-all-cameras map** (`/cameras`) — every camera on file statewide
  (~1,958: 1,568 WSDOT + 390 Seattle) on one clustered map, pure browsing,
  no AI involved, images load on click rather than all at once.
- **Auto-refreshing feed images** — these are periodically-refreshed
  stills, not live video; "live" just means re-fetching the same URL on a
  timer (every 20s) rather than a manual click.

## Cron reliability

Two distinct bugs found and fixed, both real production incidents, not
hypothetical:
1. **Non-JPEG responses crashing the pipeline** — a camera occasionally
   returns an HTML error/placeholder page past the size floor, which made
   `sharp` throw and failed the *entire* route check with a 500. Fixed by
   validating the JPEG magic bytes at the fetch boundary.
2. **Fire-and-forget Redis write not completing** — `setSignature` wasn't
   awaited, and serverless can freeze the function right after it responds,
   so the frame-differencing baseline often never got written. Fixed by
   awaiting the write.

Open, unresolved: GitHub Actions' `schedule` trigger does not reliably fire
every 10 minutes as configured — observed gaps of 3-6 hours in practice,
which breaks the change-signal's 2-hour baseline TTL. Recommended fix
(not yet confirmed done): move the trigger to Upstash QStash, which the
project already has an account for.

## Distillation prep: training log

`lib/trainingLog.ts` logs every classified checkpoint — engineered features
plus Gemini's own label — to a rolling Redis list, as the raw material for
eventually training a small distilled classifier. Logged fields: `change`,
`edgeDensity`, `vehicleCount`, `flowReading` (WSDOT sensor), `travelRatio`
and `incident` (WSDOT travel-time/alerts, added for corridor-level context
the single point-sensor can't give), `hour`, `cameraId`, `condition`.

### First baseline attempt (731 rows, then re-run at 2,102 rows)

A from-scratch multinomial logistic regression, leave-one-camera-out
validated (tested only on cameras never seen in training).

- **Class-balanced weighting:** 19-20% accuracy vs. an 80-85% "always
  predict clear" trivial baseline. Over-predicts rare classes.
- **Unweighted:** ~83% accuracy (close to trivial baseline) but 0% recall
  on slow/stopped/unreadable — it just learned to say "clear."
- **Result did not improve** between 731 and 2,102 rows (macro F1 stayed
  ~0.18-0.22) — ruled out "just needs more data" as the fix.

### Diagnosing why, using independent signals

- **WSDOT point-sensor agreement is weak**: Gemini's "congested" calls
  matched the sensor only ~10% of the time. Looked damning at first.
- **But WSDOT corridor travel-ratio (current/typical drive time) shows a
  real, monotonic trend**: mean ratio 1.01 for clear, 1.05 slow, 1.12
  congested, 1.18 stopped. This is the opposite conclusion from the point
  sensor — it suggests Gemini's labels aren't noise, the point-sensor is
  just too spatially narrow (often not co-located with what the camera
  actually sees) to validate rare classes.
- **Binning by travel ratio confirmed a real threshold effect**: at
  ratio ≥ 1.2, congested+stopped jumps to 40% of rows vs. ~4% baseline — an
  8-10x lift, invisible to a linear model (threshold effects need splits,
  not straight lines).
- **A decision tree (to actually use that threshold) only modestly
  improved** macro F1 to 0.22 — confirmed the signal is real but the model
  is currently starved: only 57% of checkpoints have a travel-ratio match
  at all (0.5mi radius was too narrow for how the API's segment endpoints
  approximate curvy real roads), and absolute rare-class volume is thin
  (109 congested, 70 stopped) after over a month of *uniform* 24/7
  collection rather than commute-hour-weighted collection.

**Conclusion: not a label-quality problem after all — a coverage and
collection-targeting problem.** Two fixes shipped:
1. Widened the travel-time segment match radius from 0.5mi to 1.5mi
   (verified against real data before changing it: lifts WSDOT camera
   coverage from 77% to 88%; beyond 1.5mi the remaining cameras are 2mi+
   away and not meaningfully on a tracked corridor). **Confirmed live** —
   checked the next production run after deploy: every one of the newest
   logged checkpoints now carries a `travelRatio`, where roughly half
   previously had none.
2. Changed the check schedule from uniform `*/10 * * * *` all day to three
   partitioned windows: every 5 min during commute hours (~6-10am and
   ~3-7pm Pacific), every 30 min otherwise.

### Trigger moved off GitHub Actions entirely: Upstash QStash

GitHub Actions' `schedule` trigger never reliably fired on time no matter
the cron expression — observed gaps of 3-6 hours against a configured
10-minute interval, confirmed across multiple separate incidents (see Cron
reliability above). Rather than keep tuning a cron expression GitHub wasn't
honoring, moved the trigger to Upstash QStash, which the project already
had an account for.

Three QStash schedules (`commute-morning`, `commute-evening`,
`commute-offpeak`) call `/api/cron/check` directly via HTTP, using
`CRON_TZ=America/Los_Angeles` for proper DST-aware local time instead of
the manual UTC-hour-splitting GitHub's cron required. Auth is forwarded via
`Upstash-Forward-Authorization`, matching the existing `Bearer` check
already in the route.

**Confirmed working**, not just configured: training log grew by 165 rows
in 82 minutes immediately after the schedules were created, consistent
with ~5 min firing during the evening commute window, then correctly
dropping to the ~30 min off-peak rate right at the 7pm Pacific boundary.
GitHub Actions' `schedule` trigger is now disabled (`workflow_dispatch`
kept for manual runs) — no reason to keep two triggers once one is proven
unreliable and the other is proven working.

One real incident during this migration, worth recording: QStash and
CRON_SECRET credentials were accidentally pasted into chat while
troubleshooting a PowerShell/curl syntax error. Both were rotated
immediately. Lesson for next time — hand over the error output, not the
full command with the secret still in it.

### Rerunning the baseline after QStash: confirmed a plateau, not a fluke

One day after the QStash migration the log had grown from 2,282 to 4,246
rows and travel-ratio coverage had risen to 72% (from 57%) thanks to the
radius widening. Reran both the linear model and the decision tree on this
larger, better-covered data.

- **Macro F1 stayed flat at ~0.21-0.22** across every variant (linear,
  class-balanced linear, shallow tree, deeper tree) - more data and better
  coverage did not break through the ceiling hit two weeks earlier.
- **One real improvement**: the class-balanced linear model's congestion
  detection got meaningfully better - 52% recall / 26% precision on
  "congested" (F1 0.34), up from 42%/17%. Not a classifier to trust
  standalone, but a usable secondary signal.
- **Conclusion: the bottleneck was never data volume.** All five features
  fed to every model tried (vehicle count, frame-diff change, travel ratio,
  hour, incident) are single numbers *derived from* the image - a
  classifier trained only on those can never learn anything the numbers
  don't already express, no matter how much data it sees. This was the
  user's own insight, prompted by asking "why not just use a vision model"
  after being walked through the plateau.

### The actual fix: a real vision embedding, not more hand-picked numbers

Added `lib/visionEmbedding.ts`: a pretrained MobileNetV3-Small (ImageNet),
truncated to its pooled feature layer before the classifier - 576 numbers
that describe the actual visual content, computed via `onnxruntime-node`
(the same deployment path already proven for vehicle detection) at the
same point the image is already loaded for YOLO. Quantized to int8 and
base64-encoded before logging (~700 bytes/example) rather than storing raw
images - the past month+ of data never saved pixels, only derived numbers,
so there's no way to retrofit this onto old rows; it starts capturing
something richer going forward instead.

Preprocessing (resize shorter side to 256, center-crop 224, ImageNet
normalization) was built to replicate torchvision's official weights
transform exactly, and validated locally against the real PyTorch model's
output on real WSDOT images before shipping - 0.99 cosine similarity
between the Node and Python pipelines on the same image.

**A real deployment dead end, same spirit as the earlier WASM one, worth
recording:** the first export (PyTorch's newer dynamo-based exporter)
silently split the ~4MB model into a small graph file and a separate
external-data weights file. Only the graph file got committed, so every
embedding extraction failed in production immediately on session creation.
Fixing that by shipping both files *didn't work either* - confirmed
reproducible twice, not a fluke: Next's serverless file tracer would not
include the external-data file in the deployed function no matter how it
was referenced in `outputFileTracingIncludes`, matching the same class of
tracer limitation hit during the vehicle-detection rollout (`.mjs` files
back then). The real fix was avoiding external data entirely - re-exporting
with `dynamo=False` (the legacy TorchScript-based exporter, same code path
Ultralytics used for the YOLO export) keeps weights inline in one file,
which traces and deploys correctly. Re-validated after re-exporting:
identical 0.99 cosine similarity, confirming no quality was lost switching
exporters.

**Confirmed working in production**, not just deployed: the next real
check logged real 768-character base64 embeddings (576 bytes, exactly the
expected size) on every checkpoint.

### Tracking embedding volume toward a real training attempt

Added `withEmbedding` and `embeddingByCondition` to the public stats
endpoint so progress is checkable anytime without the gated export. Can't
backfill the ~4,300 pre-embedding rows - the images behind them are gone,
never stored, so this starts from zero regardless of how much
five-number-feature data already exists.

**Baseline, right after shipping:** 30 examples with an embedding (21
clear, 9 slow; zero congested/stopped/unreadable yet - only ~1 hour of
collection so far).

**Rough target before attempting a real training run:** at least a few
hundred examples in each of the rare classes (congested, stopped) with an
embedding attached. This is an estimate based on how the five-number
baseline behaved, not a guarantee the embedding model needs the same
volume - richer features might need less, but there's no way to know
until there's enough to actually try. Given current collection pace and
how long the rare classes took to reach their present counts (weeks), this
is realistically a multi-week wait, not days.

## Current state (as of this entry)

- 4,336 labeled examples, 58 unique cameras, growing continuously.
- Condition mix: clear 3,422 (79%), slow 380 (8.8%), congested 298 (6.9%),
  stopped 153 (3.5%), unreadable 68 (1.6%) (pre-embedding-tracking
  snapshot, still accurate for the overall shape).
- Change-signal coverage: 2,523 of 4,321 (58%).
- Embedding coverage: 30 of 4,336 (0.7%) - just started, see tracking
  note above for the real baseline and target.
- No distilled model shipped yet - correctly not ready, and now has a
  concrete, trackable condition for when to try: enough embedding-labeled
  volume in the rare classes.
