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

## Current state (as of this entry)

- 2,282+ labeled examples (growing continuously now, no longer gated by an
  unreliable trigger), 58+ unique cameras.
- Condition mix (previous snapshot, pre-reweighting): clear 83%, congested
  5.2%, slow 5.9%, stopped 3.3%, unreadable 2.4%. Expect this to shift as
  commute-hour-weighted collection accumulates — not yet re-measured since
  the schedule change.
- Travel-ratio coverage: was 57% of checkpoints, confirmed improved after
  the radius widening (not yet re-measured as a percentage at scale).
- No distilled model shipped yet — correctly not ready; the data pipeline
  itself was the blocker, now being addressed.
