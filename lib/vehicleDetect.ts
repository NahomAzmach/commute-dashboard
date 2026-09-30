import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'path';

const MODEL_PATH = path.join(process.cwd(), 'models', 'yolov8n.onnx');
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

// COCO class indices (0-indexed, standard COCO ordering) for vehicle types.
const VEHICLE_CLASSES = new Set([2, 3, 5, 7]); // car, motorcycle, bus, truck

/**
 * Real, pretrained (COCO) vehicle detection via YOLOv8n. No training data of
 * our own is needed: this model already knows what a car/truck/bus looks
 * like from COCO, so it works on any WSDOT camera from day one.
 *
 * Runs via onnxruntime-node (native binary) rather than onnxruntime-web's
 * wasm backend - wasm was tried first specifically to avoid native-binary
 * deployment risk (the same class of problem that broke sharp on Windows
 * earlier in this project), but onnxruntime-web's own internal dynamic
 * module loading turned out to be un-traceable by Next's serverless file
 * tracing (a real, confirmed-in-production dead end, not a guess). sharp
 * itself is the existing precedent that native binaries deploy fine on
 * Vercel's actual Linux build target - the earlier breakage was strictly a
 * local Windows dev-environment issue, not a serverless one. This still
 * needs its native binary explicitly force-included (see
 * next.config.js) since Next's tracer doesn't discover it automatically
 * either.
 *
 * Validated against real WSDOT stills before wiring in: a reference PyTorch
 * run against a diverse sample, spot-checked by eye against the source
 * images. Letterbox preprocessing (not a stretched resize) was necessary to
 * match that reference model's accuracy - stretching measurably hurt
 * detection of small/distant vehicles. Known limitation: low-contrast
 * scenes (heavy fog/rain) can still miss small distant vehicles - treat the
 * count as a real but imperfect signal, same spirit as the
 * frame-differencing "change" score - corroborating evidence, not ground
 * truth.
 */

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  // Lazy singleton - a warm serverless instance reuses it across every
  // checkpoint and every subsequent invocation instead of reloading it
  // (and its ~45MB native binary) per image.
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
    });
  }
  return sessionPromise;
}

async function preprocess(bytes: Uint8Array): Promise<Float32Array> {
  // Letterbox (preserve aspect ratio, pad with YOLO's standard gray) rather
  // than a stretched resize - stretching measurably hurt detection of
  // small/distant vehicles in calibration testing.
  const { data } = await sharp(Buffer.from(bytes))
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'contain', background: { r: 114, g: 114, b: 114 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const floatData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    floatData[i] = data[i * 3] / 255;
    floatData[plane + i] = data[i * 3 + 1] / 255;
    floatData[plane * 2 + i] = data[i * 3 + 2] / 255;
  }
  return floatData;
}

type Box = { x1: number; y1: number; x2: number; y2: number; score: number; cls: number };

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

function nms(boxes: Box[]): Box[] {
  boxes.sort((a, b) => b.score - a.score);
  const keep: Box[] = [];
  for (const box of boxes) {
    if (keep.every((k) => k.cls !== box.cls || iou(k, box) < IOU_THRESHOLD)) {
      keep.push(box);
    }
  }
  return keep;
}

// Output tensor shape [1, 84, 8400]: 4 box coords + 80 COCO class scores,
// per anchor point.
function decode(output: ort.Tensor): Box[] {
  const data = output.data as Float32Array;
  const numAnchors = output.dims[2];
  const numClasses = output.dims[1] - 4;
  const boxes: Box[] = [];

  for (let i = 0; i < numAnchors; i++) {
    let bestScore = 0;
    let bestCls = -1;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numAnchors + i];
      if (score > bestScore) {
        bestScore = score;
        bestCls = c;
      }
    }
    if (bestScore < CONF_THRESHOLD || !VEHICLE_CLASSES.has(bestCls)) continue;

    const cx = data[0 * numAnchors + i];
    const cy = data[1 * numAnchors + i];
    const w = data[2 * numAnchors + i];
    const h = data[3 * numAnchors + i];
    boxes.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: bestScore, cls: bestCls });
  }
  return nms(boxes);
}

/**
 * Counts vehicles (car/motorcycle/bus/truck) in a single camera still.
 * Returns null on any failure - detection is a corroborating signal, never
 * a reason to fail a live check.
 */
export async function countVehicles(bytes: Uint8Array): Promise<number | null> {
  try {
    const session = await getSession();
    const input = await preprocess(bytes);
    const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    return decode(output).length;
  } catch (err) {
    // TEMPORARY: capture the real error for one more round of production
    // debugging (onnxruntime-node's native binary loading is the current
    // unknown). Remove once diagnosed.
    const { Redis } = require('@upstash/redis');
    void Redis.fromEnv().set(
      'debug:vehicleDetect:lastError',
      err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
      { ex: 3600 },
    );
    return null;
  }
}
