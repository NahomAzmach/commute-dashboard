import { NextRequest, NextResponse } from 'next/server';
import { ROUTES } from '../../../../lib/checkpoints';
import { runLiveCheck } from '../../../../lib/liveCheck';
import { sendPush } from '../../../../lib/notify';
import { getLastPrimaryScore, setLastPrimaryScore, getState, setState } from '../../../../lib/store';

export const maxDuration = 60;

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
      runLiveCheck(ROUTES[0].key, ROUTES[0].label, ROUTES[0].checkpoints),
      runLiveCheck(ROUTES[1].key, ROUTES[1].label, ROUTES[1].checkpoints),
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
