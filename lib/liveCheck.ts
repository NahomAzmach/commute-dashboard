import { describeImage, classifyRoute } from './ai';
import type { RouteStatus } from './store';

export type GenericCheckpoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
};

async function describeWithRetry(imageUrl: string): Promise<string> {
  try {
    return await describeImage(imageUrl);
  } catch {
    try {
      return await describeImage(imageUrl);
    } catch (secondError) {
      const msg = secondError instanceof Error ? secondError.message : String(secondError);
      return `could not read camera frame (${msg.slice(0, 120)})`;
    }
  }
}

/**
 * Runs the shared vision-read + JEV pipeline against an arbitrary list of
 * checkpoints. Used both by the scheduled personal-commute check and the
 * on-demand /explore route.
 */
export async function runLiveCheck(
  routeKey: string,
  label: string,
  checkpoints: GenericCheckpoint[],
): Promise<RouteStatus> {
  const results = await Promise.all(
    checkpoints.map(async (cp) => ({
      id: cp.id,
      title: cp.title,
      imageUrl: cp.imageUrl,
      lat: cp.lat,
      lon: cp.lon,
      description: await describeWithRetry(cp.imageUrl),
    })),
  );
  const state = results.map((c, i) => `${i + 1}. ${c.title}: ${c.description}`).join('\n');
  const verdict = await classifyRoute(state);
  return {
    routeKey,
    label,
    heavyTrafficProbability: verdict.heavyTrafficProbability,
    delaySeverityScore: verdict.delaySeverityScore,
    checkpoints: results,
    updatedAt: new Date().toISOString(),
  };
}
