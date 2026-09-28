import { Redis } from '@upstash/redis';

const kv = Redis.fromEnv();

export type CheckpointResult = {
  id: number;
  title: string;
  imageUrl: string;
  description: string;
  lat: number;
  lon: number;
};

export type RouteStatus = {
  routeKey: string;
  label: string;
  heavyTrafficProbability: number;
  delaySeverityScore: number;
  checkpoints: CheckpointResult[];
  updatedAt: string;
};

export type DashboardState = {
  primary?: RouteStatus;
  alternate?: RouteStatus;
  recommendation?: string;
  lastCheckDate?: string;
  lastNotifiedAt?: string;
};

const STATE_KEY = 'commute:state';
const LAST_SCORE_KEY = 'commute:last_primary_score';

export async function getState(): Promise<DashboardState> {
  try {
    const state = await kv.get<DashboardState>(STATE_KEY);
    return state ?? {};
  } catch {
    // Redis not configured yet (e.g. before the Upstash integration is
    // connected) - render the dashboard's empty state instead of a 500.
    return {};
  }
}

export async function setState(state: DashboardState) {
  await kv.set(STATE_KEY, state);
}

export async function getLastPrimaryScore(): Promise<number | null> {
  const v = await kv.get<number>(LAST_SCORE_KEY);
  return v ?? null;
}

export async function setLastPrimaryScore(score: number) {
  await kv.set(LAST_SCORE_KEY, score);
}
