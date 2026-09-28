import { generateObject } from 'ai';
import { z } from 'zod';

const MODEL = 'google/gemini-2.5-flash-lite';

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    // A real camera JPEG is at least a few KB; anything tinier is almost
    // certainly a broken/placeholder response, not a frame worth reading.
    if (buf.byteLength < 500) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export const CONDITIONS = ['clear', 'slow', 'congested', 'stopped', 'unreadable'] as const;
export type Condition = (typeof CONDITIONS)[number];

const AssessmentSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        description: z
          .string()
          .describe(
            'One concrete sentence stating only what is visible: vehicle spacing and ' +
              'density, brake-light or headlight patterns, any stopped vehicles, lane ' +
              'blockages, weather or visibility conditions.',
          ),
        condition: z
          .enum(CONDITIONS)
          .describe(
            'Pick exactly one, based only on the image: "clear" = free-flowing, normal ' +
              'speed and spacing, INCLUDING a vehicle stopped at a visible traffic signal, ' +
              'stop sign, or crosswalk with no queue behind it - that is normal controlled ' +
              'stopping, not congestion. "slow" = minor slowdown, still moving. "congested" ' +
              '= dense moving-lane traffic with visible brake lights and clearly reduced ' +
              'speed. "stopped" = multiple vehicles queued and stopped or crawling in ' +
              'through-traffic lanes (not vehicles waiting their turn at an intersection). ' +
              '"unreadable" = the image genuinely shows nothing usable, or shows something ' +
              'other than moving traffic entirely (an empty parking lot, a ferry holding ' +
              'lot with no queue, a closed gate) - not just because it is nighttime or ' +
              'imperfectly lit.',
          ),
      }),
    )
    .describe('One entry per checkpoint image, in the exact same order they were given.'),
  reasoning: z
    .string()
    .describe(
      'Brief note on anything ambiguous across the checkpoints and how you resolved it.',
    ),
});

export type RouteAssessment = z.infer<typeof AssessmentSchema>;

const CONDITION_VALUE: Record<Condition, number | null> = {
  clear: 0,
  slow: 1,
  congested: 2,
  stopped: 3,
  unreadable: null,
};

/**
 * Route score is computed deterministically from the per-checkpoint
 * condition labels rather than asking the model to freely judge an
 * aggregate itself (see notes on the earlier consistency investigation).
 * Reaching the top tier requires corroborating evidence from more than one
 * checkpoint - a single isolated "stopped" or "congested" reading (which
 * can include a misread, e.g. a car at a red light) surfaces as a real but
 * moderate flag instead of an immediate "severe, reroute now."
 */
function computeSeverity(values: (number | null)[]): { score: number; probability: number } {
  const readable = values.filter((v): v is number => v !== null);
  if (readable.length === 0) return { score: 0, probability: 0 };

  const stoppedCount = readable.filter((v) => v === 3).length;
  const congestedCount = readable.filter((v) => v === 2).length;
  const slowCount = readable.filter((v) => v === 1).length;
  const badCount = stoppedCount + congestedCount;

  let score: number;
  if (stoppedCount >= 2 || (stoppedCount >= 1 && congestedCount >= 1) || congestedCount >= 3) {
    score = 3;
  } else if (badCount >= 1) {
    score = 2;
  } else if (slowCount >= 1) {
    score = 1;
  } else {
    score = 0;
  }

  const avg = readable.reduce((a, b) => a + b, 0) / readable.length;
  const probability = Math.min(1, avg / 3 + (badCount >= 2 ? 0.15 : 0));

  return { score, probability };
}

/**
 * Single combined call: every checkpoint image for a route goes to one
 * vision-capable model in one request, which reads all of them together and
 * classifies each.
 */
export async function assessRoute(
  checkpoints: { title: string; imageUrl: string }[],
): Promise<{
  perCheckpoint: (string | null)[];
  perCheckpointCondition: (Condition | null)[];
  delaySeverityScore: number;
  heavyTrafficProbability: number;
  reasoning: string;
}> {
  const fetched = await Promise.all(
    checkpoints.map(async (cp) => ({ cp, bytes: await fetchImageBytes(cp.imageUrl) })),
  );
  const readable = fetched.filter((f) => f.bytes !== null) as {
    cp: { title: string; imageUrl: string };
    bytes: Uint8Array;
  }[];

  if (readable.length === 0) {
    return {
      perCheckpoint: checkpoints.map(() => null),
      perCheckpointCondition: checkpoints.map(() => null),
      delaySeverityScore: 0,
      heavyTrafficProbability: 0,
      reasoning: 'No checkpoint images could be loaded, so no assessment could be made.',
    };
  }

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: Uint8Array }
  > = [
    {
      type: 'text',
      text:
        `You are assessing live traffic conditions from ${readable.length} highway camera ` +
        'stills along one driving route, in order from the start of the drive to the end. ' +
        'For each image below, you will see its checkpoint label immediately before it. ' +
        'Only describe what is concretely visible - do not assume conditions from the time ' +
        'of day or camera name.\n\n' +
        'Many of these are nighttime images. A dark image is not automatically unreadable: ' +
        'headlight and taillight patterns, brake-light clusters, motion blur (streaks mean ' +
        'a vehicle is moving at speed; sharp, static lights mean it is stopped or crawling), ' +
        'and relative spacing between light clusters are all still visible at night and are ' +
        'real evidence you should use. Only classify an image as unreadable if none of that ' +
        'is discernible at all - do not default to that answer just because it is nighttime ' +
        'or the lighting is imperfect.\n\n' +
        'Some cameras are on surface streets, ferry terminals, or intersections rather than ' +
        'the highway itself. A single vehicle stopped at a visible traffic signal, stop ' +
        'line, or crosswalk with nothing queued behind it is a normal controlled stop, not ' +
        'traffic congestion - do not classify that as "stopped" or "congested". An empty ' +
        'ferry holding lot or parking area with no vehicles queued is not a traffic signal ' +
        'either way.',
    },
  ];
  readable.forEach(({ cp }, i) => {
    content.push({ type: 'text', text: `Checkpoint ${i + 1}: ${cp.title}` });
    content.push({ type: 'image', image: readable[i].bytes });
  });
  content.push({
    type: 'text',
    text: 'Now classify each checkpoint above (same order) and give your reasoning.',
  });

  // One call, all images together. Verified against frozen (fixed-byte)
  // test images that temperature 0 gives byte-identical classifications
  // across repeat calls, so there is no sampling noise here to average out.
  const result = await generateObject({
    model: MODEL,
    schema: AssessmentSchema,
    messages: [{ role: 'user', content }],
    temperature: 0,
  });

  const perCheckpoint: (string | null)[] = checkpoints.map(() => null);
  const perCheckpointCondition: (Condition | null)[] = checkpoints.map(() => null);
  const perCheckpointValues: (number | null)[] = [];
  let readableIdx = 0;
  fetched.forEach((f, i) => {
    if (f.bytes !== null) {
      const entry = result.object.checkpoints[readableIdx];
      perCheckpoint[i] = entry?.description ?? null;
      perCheckpointCondition[i] = entry?.condition ?? null;
      perCheckpointValues.push(entry ? CONDITION_VALUE[entry.condition] : null);
      readableIdx += 1;
    }
  });

  const { score, probability } = computeSeverity(perCheckpointValues);

  return {
    perCheckpoint,
    perCheckpointCondition,
    delaySeverityScore: score,
    heavyTrafficProbability: probability,
    reasoning: result.object.reasoning,
  };
}
