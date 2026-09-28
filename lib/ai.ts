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

const AssessmentSchema = z.object({
  checkpointDescriptions: z
    .array(z.string())
    .describe(
      'One entry per checkpoint image, in the exact same order they were given. Each ' +
        'description must state only what is concretely visible: vehicle spacing and ' +
        'density, presence of brake lights or headlight clusters, any stopped vehicles, ' +
        'lane blockages, weather or visibility conditions. If an image is too dark, blank, ' +
        'or otherwise too ambiguous to assess, say exactly that instead of guessing.',
    ),
  reasoning: z
    .string()
    .describe(
      'Brief step-by-step reasoning across all checkpoints, written before you decide the ' +
        'scores below: which checkpoints show concrete evidence of congestion, which are ' +
        'ambiguous or unreadable, and how that adds up to an overall picture of the route.',
    ),
  delaySeverityScore: z
    .number()
    .min(0)
    .max(3)
    .describe(
      'Overall delay severity for the whole route, grounded in the visual evidence above. ' +
        '0 = free-flowing traffic with clear visual evidence at every readable checkpoint. ' +
        '1 = minor slowdowns visible at one or two checkpoints, otherwise clear. ' +
        '2 = clear congestion (dense traffic, visible brake lights, reduced speed) at one or ' +
        'more checkpoints. 3 = stopped or near-stopped traffic at multiple checkpoints. ' +
        'Unreadable/ambiguous checkpoints should not by themselves push the score up or down.',
    ),
  heavyTrafficProbability: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Probability that there is heavy or stopped traffic somewhere on this route right ' +
        'now, based only on the visual evidence actually described above.',
    ),
});

export type RouteAssessment = z.infer<typeof AssessmentSchema>;

/**
 * Single combined call: every checkpoint image for a route goes to one
 * vision-capable model in one request, which reads all of them together and
 * returns a structured, reasoned verdict. Replaces the old per-image
 * description pass followed by a separate JEV classification call - one
 * model, one call, no second opinion needed.
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
        'of day or camera name. Many of these are nighttime images; say so and describe ' +
        'what can still be seen rather than treating darkness itself as a traffic signal.',
    },
  ];
  readable.forEach(({ cp }, i) => {
    content.push({ type: 'text', text: `Checkpoint ${i + 1}: ${cp.title}` });
    content.push({ type: 'image', image: readable[i].bytes });
  });
  content.push({
    type: 'text',
    text: 'Now provide checkpointDescriptions (one per image above, same order), your reasoning, and the two overall route scores.',
  });

  const result = await generateObject({
    model: MODEL,
    schema: AssessmentSchema,
    messages: [{ role: 'user', content }],
  });

  // Splice the model's per-image descriptions back into the original
  // checkpoint order, leaving a null for any checkpoint whose image never
  // loaded in the first place.
  const perCheckpoint: (string | null)[] = checkpoints.map(() => null);
  let readableIdx = 0;
  fetched.forEach((f, i) => {
    if (f.bytes !== null) {
      perCheckpoint[i] = result.object.checkpointDescriptions[readableIdx] ?? null;
      readableIdx += 1;
    }
  });

  return {
    perCheckpoint,
    delaySeverityScore: result.object.delaySeverityScore,
    heavyTrafficProbability: result.object.heavyTrafficProbability,
    reasoning: result.object.reasoning,
  };
}
