import { getState } from '../lib/store';
import { HOME, WORK, USUAL_LEAVE_TIME, HOME_COORDS, WORK_COORDS, ROUTES } from '../lib/checkpoints';
import type { RouteStatus } from '../lib/store';
import RouteMapLoader from '../components/RouteMapLoader';
import RefreshFeedButton from '../components/RefreshFeedButton';
import type { MapRoute } from '../components/RouteMap';

export const dynamic = 'force-dynamic';

type Tone = 'good' | 'warn' | 'bad';

function toneForScore(score: number): Tone {
  if (score < 1) return 'good';
  if (score < 3) return 'warn';
  return 'bad';
}

function headlineForScore(score: number): string {
  if (score < 1) return 'GO NOW — ROUTE CLEAR';
  if (score < 2) return 'MINOR DELAYS';
  if (score < 3) return 'HEAVY TRAFFIC BUILDING';
  return 'SEVERE — HOLD OR REROUTE';
}

function SeverityMeter({ score, label }: { score: number; label: string }) {
  const idx = Math.round(Math.min(3, Math.max(0, score)));
  const tone = toneForScore(score);
  const litClass = tone === 'good' ? 'lit-good' : tone === 'warn' ? 'lit-warn' : 'lit-bad';
  return (
    <>
      <span className="severity-label">{label}</span>
      <span className="severity-meter" aria-hidden="true">
        {[0, 1, 2, 3].map((bar) => (
          <span key={bar} className={`severity-bar${bar <= idx ? ` ${litClass}` : ''}`} />
        ))}
      </span>
    </>
  );
}

const SEVERITY_WORDS = ['CLEAR', 'LIGHT', 'MODERATE', 'SEVERE'];

function severityWord(score: number) {
  return SEVERITY_WORDS[Math.round(Math.min(3, Math.max(0, score)))];
}

function RouteSection({ route, index }: { route: RouteStatus; index: number }) {
  return (
    <section className="route-section">
      <div className="route-heading">
        <span className="route-index">{String(index).padStart(2, '0')}</span>
        <h2 className="route-name">{route.label}</h2>
        <SeverityMeter score={route.delaySeverityScore} label={severityWord(route.delaySeverityScore)} />
      </div>
      <div className="feed-grid">
        {route.checkpoints.map((cp, i) => (
          <div className="feed-tile" key={cp.title}>
            <div className="feed-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cp.imageUrl} data-live-src={cp.imageUrl} alt={cp.title} loading="lazy" />
              <span className="feed-index">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="feed-caption">
              <p className="feed-title">{cp.title}</p>
              <p className="feed-desc">{cp.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildMapRoutes(state: Awaited<ReturnType<typeof getState>>): MapRoute[] {
  if (state.primary && state.alternate) {
    return [state.primary, state.alternate].map((route) => ({
      key: route.routeKey,
      label: route.label,
      tone: toneForScore(route.delaySeverityScore),
      checkpoints: route.checkpoints.map((cp) => ({
        id: cp.id,
        title: cp.title,
        lat: cp.lat,
        lon: cp.lon,
        imageUrl: cp.imageUrl,
        description: cp.description,
      })),
    }));
  }
  // No check has run yet - plot the static route config so the map still
  // shows something meaningful, just without live descriptions or tone.
  return ROUTES.map((route) => ({
    key: route.key,
    label: route.label,
    tone: 'unknown' as const,
    checkpoints: route.checkpoints.map((cp) => ({
      id: cp.id,
      title: cp.title,
      lat: cp.lat,
      lon: cp.lon,
      imageUrl: cp.imageUrl,
    })),
  }));
}

export default async function Page() {
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
        <div className="hudbar-route">
          MARYSVILLE &rarr; BELLEVUE &middot; USUAL LEAVE {USUAL_LEAVE_TIME} PT
        </div>
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
        <div className="verdict">
          <div className="verdict-eyebrow">Current call</div>
          <h2 className={`verdict-headline tone-${toneForScore(state.primary.delaySeverityScore)}`}>
            {headlineForScore(state.primary.delaySeverityScore)}
          </h2>
          {state.recommendation && <p className="verdict-detail">{state.recommendation}</p>}
          <div className="verdict-meta">
            LAST SWEEP{' '}
            {new Date(state.primary.updatedAt)
              .toLocaleString('en-US', {
                timeZone: 'America/Los_Angeles',
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
                day: 'numeric',
              })
              .toUpperCase()}{' '}
            PT
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <strong>AWAITING FIRST SWEEP</strong>
          The scheduled morning check hasn&apos;t run yet. Checks fire every 10 minutes,
          weekday mornings — come back around 6:00 AM Pacific, or trigger one manually.
        </div>
      )}

      <section className="map-section">
        <RouteMapLoader routes={mapRoutes} home={HOME_COORDS} work={WORK_COORDS} />
      </section>

      {state.primary && <RouteSection route={state.primary} index={1} />}
      {state.alternate && <RouteSection route={state.alternate} index={2} />}

      <div className="foot">
        Live stills served directly from images.wsdot.wa.gov &middot; congestion calls from
        typesafe-ai/jev via Vercel AI Gateway
      </div>
    </main>
  );
}
