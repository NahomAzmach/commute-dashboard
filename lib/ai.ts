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

const CONDITIONS = ['clear', 'slow', 'congested', 'stopped', 'unreadable'] as const;
type Condition = (typeof CONDITIONS)[number];

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
              'speed and spacing. "slow" = minor slowdown, still moving. "congested" = ' +
              'dense traffic with visible brake lights and clearly reduced speed. ' +
              '"stopped" = vehicles stopped or crawling at a near-stop. "unreadable" = the ' +
              'image genuinely shows nothing usable - not just because it is nighttime or ' +
              'imperfectly lit. Night images with visible headlight/taillight patterns, ' +
              'motion blur, or spacing are readable; only use "unreadable" when none of ' +
              'that is discernible at all.',
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

/**
 * The route-level score and probability are computed deterministically from
 * the model's per-checkpoint condition labels, rather than asking the model
 * to freely judge an aggregate score itself. A discrete 5-way classification
 * per image is a far more repeatable task for a small model than a holistic
 * continuous judgment across 8 images at once - in testing, the latter
 * swung meaningfully (e.g. 1 vs 2 out of 3) on identical images seconds
 * apart, even at temperature 0.
 */
const CONDITION_VALUE: Record<Condition, number | null> = {
  clear: 0,
  slow: 1,
  congested: 2,
  stopped: 3,
  unreadable: null,
};

/**
 * Combines two independent classification samples per checkpoint by
 * averaging their numeric condition values, then derives a route score from
 * those averaged, smoother per-checkpoint values - a single sample flipping
 * one category (e.g. "congested" vs "stopped") now moves the result by a
 * fraction of a point instead of swinging the whole route's score.
 */
function computeSeverity(perCheckpointAverages: (number | null)[]): {
  score: number;
  probability: number;
} {
  const readable = perCheckpointAverages.filter((v): v is number => v !== null);
  if (readable.length === 0) return { score: 0, probability: 0 };

  const maxVal = Math.max(...readable);
  const elevatedCount = readable.filter((v) => v >= 1.5).length;

  // Severity tracks the single worst point on the route; two or more
  // elevated points push it further toward the top of the scale.
  let score = maxVal;
  if (elevatedCount >= 2) score = Math.min(3, score + 0.5);
  score = Math.max(0, Math.min(3, score));

  const avg = readable.reduce((a, b) => a + b, 0) / readable.length;
  const probability = Math.min(1, avg / 3 + (elevatedCount >= 2 ? 0.15 : 0));

  return { score, probability };
}

/**
 * Single combined call: every checkpoint image for a route goes to one
 * vision-capable model in one request, which reads all of them together and
 * classifies each. Replaces the old per-image description pass followed by
 * a separate JEV classification call - one model, one call, no second
 * opinion needed, and no free-form aggregate score to be inconsistent.
 */
export async function assessRoute(
  checkpoints: { title: string; imageUrl: string }[],
): Promise<{
  perCheckpoint: (string | null)[];
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
        'or the lighting is imperfect.',
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
  // across repeat calls - the run-to-run swings seen earlier were real
  // WSDOT camera images changing between test iterations, not model noise,
  // so there is nothing here for a multi-sample ensemble to cancel out.
  const result = await generateObject({
    model: MODEL,
    schema: AssessmentSchema,
    messages: [{ role: 'user', content }],
    temperature: 0,
  });

  const perCheckpoint: (string | null)[] = checkpoints.map(() => null);
  const perCheckpointValues: (number | null)[] = [];
  let readableIdx = 0;
  fetched.forEach((f, i) => {
    if (f.bytes !== null) {
      const entry = result.object.checkpoints[readableIdx];
      perCheckpoint[i] = entry?.description ?? null;
      perCheckpointValues.push(entry ? CONDITION_VALUE[entry.condition] : null);
      readableIdx += 1;
    }
  });

  const { score, probability } = computeSeverity(perCheckpointValues);

  return {
    perCheckpoint,
    delaySeverityScore: score,
    heavyTrafficProbability: probability,
    reasoning: result.object.reasoning,
  };
}
