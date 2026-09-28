import { assessRoute } from './ai';
import type { RouteStatus } from './store';

export type GenericCheckpoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
};

/**
 * Runs the shared vision assessment against an arbitrary list of
 * checkpoints - one combined model call per route. Used both by the
 * scheduled personal-commute check and the on-demand /explore route.
 */
export async function runLiveCheck(
  routeKey: string,
  label: string,
  checkpoints: GenericCheckpoint[],
): Promise<RouteStatus> {
  const assessment = await assessRoute(checkpoints);

  const results = checkpoints.map((cp, i) => ({
    id: cp.id,
    title: cp.title,
    imageUrl: cp.imageUrl,
    lat: cp.lat,
    lon: cp.lon,
    description: assessment.perCheckpoint[i] ?? 'Could not load this camera frame.',
  }));

  return {
    routeKey,
    label,
    heavyTrafficProbability: assessment.heavyTrafficProbability,
    delaySeverityScore: assessment.delaySeverityScore,
    checkpoints: results,
    updatedAt: new Date().toISOString(),
  };
}
