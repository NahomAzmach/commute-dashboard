import { getState } from '../../lib/store';
import { HOME, WORK, USUAL_LEAVE_TIME, HOME_COORDS, WORK_COORDS, ROUTES } from '../../lib/checkpoints';
import { toneForScore } from '../../lib/severity';
import LynnwoodCameraGrid from '../../components/LynnwoodCameraGrid';
import RouteMapLoader from '../../components/RouteMapLoader';
import RefreshFeedButton from '../../components/RefreshFeedButton';
import VerdictPanel from '../../components/VerdictPanel';
import FeedGrid from '../../components/FeedGrid';
import type { MapRoute } from '../../components/RouteMap';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function buildMapRoutes(state: Awaited<ReturnType<typeof getState>>): MapRoute[] {
  return ROUTES.map((route) => {
    const liveRoute = route.key === 'primary' ? state.primary : state.alternate;
    const liveById = new Map(liveRoute?.checkpoints.map((cp) => [cp.id, cp]) ?? []);

    return {
      key: route.key,
      label: route.label,
      tone: liveRoute ? toneForScore(liveRoute.delaySeverityScore) : ('unknown' as const),
      checkpoints: route.checkpoints.map((cp) => {
        const liveCheckpoint = liveById.get(cp.id);
        return {
          ...cp,
          description: liveCheckpoint?.description,
          condition: liveCheckpoint?.condition,
        };
      }),
    };
  });
}

export default async function CommutePage() {
  const state = await getState();
  const hasData = Boolean(state.primary);
  const mapRoutes = buildMapRoutes(state);

  return (
    <main className="shell">
      <div className="hudbar">
        <div className="hudbar-title">
          <span className="live-dot" aria-hidden="true" />
          COMMUTE WATCH
        </div>
        <nav className="hudbar-nav">
          <Link href="/commute" className="hudbar-navlink active">
            MY COMMUTE
          </Link>
          <Link href="/" className="hudbar-navlink">
            EXPLORE A ROUTE
          </Link>
          <Link href="/cameras" className="hudbar-navlink">
            ALL CAMERAS
          </Link>
        </nav>
      </div>

      <div className="title-row">
        <div>
          <h1 className="wordmark">Commute Watch</h1>
          <p className="subline">
            {HOME} &rarr; {WORK}
          </p>
        </div>
        <RefreshFeedButton />
      </div>

      {hasData && state.primary ? (
        <VerdictPanel
          score={state.primary.delaySeverityScore}
          headline={state.primary.summary}
          detail={state.recommendation}
          updatedAtISO={state.primary.updatedAt}
        />
      ) : (
        <div className="empty-state">
          <strong>AWAITING FIRST SWEEP</strong>
          The scheduled morning check hasn&apos;t run yet. Checks fire every 10 minutes,
          weekday mornings — come back around 6:00 AM Pacific, or trigger one manually.
        </div>
      )}

      <section className="map-section">
        <RouteMapLoader
          routes={mapRoutes}
          pins={[
            { ...HOME_COORDS, label: 'H', title: 'Home' },
            { ...WORK_COORDS, label: 'W', title: 'Work' },
          ]}
        />
      </section>

      {state.primary && (
        <FeedGrid
          label={state.primary.label}
          index={1}
          score={state.primary.delaySeverityScore}
          checkpoints={state.primary.checkpoints}
        />
      )}
      {state.alternate && (
        <FeedGrid
          label={state.alternate.label}
          index={2}
          score={state.alternate.delaySeverityScore}
          checkpoints={state.alternate.checkpoints}
        />
      )}

      {state.alternate && (
        <FeedGrid
          label={state.alternate.label}
          index={2}
          score={state.alternate.delaySeverityScore}
          checkpoints={state.alternate.checkpoints}
        />
      )}
      <LynnwoodCameraGrid />

      <div className="foot">
        Live stills served directly from images.wsdot.wa.gov &middot; congestion calls from
        Gemini 2.5 Flash-Lite via Vercel AI Gateway
      </div>
    </main>
  );
}
