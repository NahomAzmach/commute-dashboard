import { NextRequest, NextResponse } from 'next/server';
import { ROUTES } from '../../../../lib/checkpoints';
import { describeImage, classifyRoute } from '../../../../lib/ai';
import { sendPush } from '../../../../lib/notify';
import {
  getLastPrimaryScore,
  setLastPrimaryScore,
  getState,
  setState,
  type RouteStatus,
} from '../../../../lib/store';

export const maxDuration = 60;

async function describeWithRetry(imageUrl: string): Promise<string> {
  try {
    return await describeImage(imageUrl);
  } catch (firstError) {
    try {
      return await describeImage(imageUrl);
    } catch (secondError) {
      const msg = secondError instanceof Error ? secondError.message : String(secondError);
      return `could not read camera frame (${msg.slice(0, 120)})`;
    }
  }
}

async function checkRoute(route: (typeof ROUTES)[number]): Promise<RouteStatus> {
  const checkpoints = await Promise.all(
    route.checkpoints.map(async (cp) => ({
      title: cp.title,
      imageUrl: cp.imageUrl,
      description: await describeWithRetry(cp.imageUrl),
    })),
  );
  const state = checkpoints
    .map((c, i) => `${i + 1}. ${c.title}: ${c.description}`)
    .join('\n');
  const verdict = await classifyRoute(state);
  return {
    routeKey: route.key,
    label: route.label,
    heavyTrafficProbability: verdict.heavyTrafficProbability,
    delaySeverityScore: verdict.delaySeverityScore,
    checkpoints,
    updatedAt: new Date().toISOString(),
  };
}

function todayPacificDateString() {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
}

const SEVERITY_WORDS = ['clear', 'light', 'moderate', 'severe'];

function severityWord(score: number) {
  const idx = Math.round(Math.min(3, Math.max(0, score)));
  return SEVERITY_WORDS[idx];
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secretParam = req.nextUrl.searchParams.get('secret');
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}` && secretParam !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [primary, alternate] = await Promise.all([
      checkRoute(ROUTES[0]),
      checkRoute(ROUTES[1]),
    ]);

    const prevState = await getState();
    const lastScore = await getLastPrimaryScore();
    const today = todayPacificDateString();
    const isFirstOfDay = prevState.lastCheckDate !== today;

    let recommendation: string;
    let shouldNotify = false;

    if (isFirstOfDay) {
      shouldNotify = true;
      const better =
        primary.delaySeverityScore <= alternate.delaySeverityScore ? primary : alternate;
      const routeLabel = better.routeKey === 'primary' ? 'I-5/I-405' : 'SR 9/SR 522';
      recommendation =
        `Morning check: ${routeLabel} looks best right now (${severityWord(better.delaySeverityScore)}). ` +
        (better.delaySeverityScore >= 2
          ? 'Consider leaving a little early or taking the other route.'
          : 'Good time to head out.');
    } else if (
      lastScore !== null &&
      (primary.delaySeverityScore - lastScore >= 1 ||
        (lastScore < 2 && primary.delaySeverityScore >= 2))
    ) {
      shouldNotify = true;
      recommendation = `Traffic update: your primary route (I-5/I-405) got worse — now ${severityWord(primary.delaySeverityScore)} (${primary.delaySeverityScore.toFixed(1)}/3).`;
    } else {
      recommendation = prevState.recommendation ?? 'No significant change yet.';
    }

    if (shouldNotify) {
      await sendPush(recommendation, 'Commute update');
    }

    await setLastPrimaryScore(primary.delaySeverityScore);
    await setState({
      primary,
      alternate,
      recommendation,
      lastCheckDate: today,
      lastNotifiedAt: shouldNotify ? new Date().toISOString() : prevState.lastNotifiedAt,
    });

    return NextResponse.json({
      ok: true,
      notified: shouldNotify,
      primaryScore: primary.delaySeverityScore,
      alternateScore: alternate.delaySeverityScore,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
