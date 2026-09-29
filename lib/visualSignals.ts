import sharp from 'sharp';

// Small enough that diffing/storing is trivial, large enough to catch real
// changes in the road area rather than single-pixel noise.
const SIG_WIDTH = 64;
const SIG_HEIGHT = 48;

/**
 * Downscaled grayscale "signature" of a frame, raw pixel bytes (no image
 * format wrapper) - cheap to store in Redis and cheap to diff.
 */
export async function frameSignature(bytes: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bytes))
    .resize(SIG_WIDTH, SIG_HEIGHT, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
}

/**
 * Mean absolute pixel difference between two same-sized grayscale
 * signatures, normalized to 0-1. This is plain frame-differencing /
 * background subtraction - a real, decades-old motion-detection technique,
 * not an LLM's guess about "motion blur" in a single still frame.
 *
 * Caveat worth keeping in mind: lighting changes (dusk, headlight flare,
 * camera auto-exposure) also register as "change" here. Treat this as a
 * corroborating signal alongside the image, not ground truth on its own.
 */
export function changeScore(current: Buffer, previous: Buffer): number | null {
  if (current.length !== previous.length || current.length === 0) return null;
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    total += Math.abs(current[i] - previous[i]);
  }
  return total / current.length / 255;
}

/**
 * NOT currently used in the live pipeline (see lib/ai.ts) - kept here as
 * the empirical starting point for a real follow-up.
 *
 * Edge-density / local-variance proxy for "how much visual clutter is in
 * this frame" - classical texture analysis (Sobel-style edge energy).
 * Calibration testing against real WSDOT stills found two problems: (1) raw
 * edge-energy means only spanned ~23-44 across a diverse sample, so a
 * global normalization constant either clips almost everything to the
 * ceiling or has no headroom; (2) more fundamentally, absolute edge energy
 * is dominated by each camera's fixed background texture (guardrails,
 * trees, lane markings), not vehicles - an empty road with a lot of
 * scenery can out-score a busy one with a plain background. Frame-to-frame
 * differencing (changeScore, below) sidesteps this by only reacting to
 * what actually changes, which is why it shipped and this didn't.
 *
 * The principled fix here, if revisited: track each camera's own rolling
 * baseline edge-density (low/high range observed for that specific camera
 * over time, using the same per-camera Redis storage as frame signatures)
 * and score relative to that camera's own typical range instead of a
 * fixed global threshold. A learned object/vehicle detector would sidestep
 * the background-texture confound entirely, at the cost of real deployment
 * weight (model bundling, cold starts, native-binary risk on serverless).
 */
export async function edgeDensity(bytes: Uint8Array): Promise<number> {
  const { data } = await sharp(Buffer.from(bytes))
    .resize(SIG_WIDTH, SIG_HEIGHT, { fit: 'fill' })
    .grayscale()
    // Simple Sobel-ish edge kernel - highlights sharp intensity transitions
    // (vehicle edges, headlights) rather than smooth road/sky.
    .convolve({
      width: 3,
      height: 3,
      kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  // Normalize against a generous ceiling so the result lands roughly in
  // 0-1 for typical camera stills rather than needing per-scene tuning.
  return Math.min(1, mean / 40);
}
