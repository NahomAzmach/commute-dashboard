import { generateText, experimental_evaluate as evaluate } from 'ai';

export async function describeImage(imageUrl: string): Promise<string> {
  const { text } = await generateText({
    model: 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'In one short sentence, describe the traffic conditions visible in this highway camera image ' +
              '(free-flowing, slow, stop-and-go, or stopped; mention any visible incidents). ' +
              'If it is too dark, blank, or an error frame to tell, say so plainly.',
          },
          { type: 'image', image: imageUrl },
        ],
      },
    ],
  });
  return text.trim();
}

export type RouteVerdict = {
  heavyTrafficProbability: number;
  delaySeverityScore: number;
};

export async function classifyRoute(state: string): Promise<RouteVerdict> {
  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state,
    questions: {
      heavy_traffic: {
        type: 'boolean',
        instructions:
          'Is there heavy or stopped traffic visible at any checkpoint along this commute route?',
        criteria: {
          true: 'stop-and-go or stopped traffic visible at one or more checkpoints',
          false: 'traffic is flowing freely at all checkpoints',
        },
      },
      delay_severity: {
        type: 'score',
        instructions:
          'Rate the overall traffic delay severity across all checkpoints on this commute route.',
        criteria: [
          'clear: free-flowing traffic at every checkpoint',
          'light: minor slowdowns at a checkpoint or two',
          'moderate: noticeable congestion at one or more chokepoints',
          'severe: stop-and-go or stopped traffic across multiple segments',
        ],
      },
    },
  });
  const answers = result.answers as any;
  return {
    heavyTrafficProbability: answers.heavy_traffic.probability,
    delaySeverityScore: answers.delay_severity.score,
  };
}
