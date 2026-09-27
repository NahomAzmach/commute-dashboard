import { getState } from '../lib/store';
import { HOME, WORK, USUAL_LEAVE_TIME } from '../lib/checkpoints';
import type { RouteStatus } from '../lib/store';

export const dynamic = 'force-dynamic';

const SEVERITY_LABELS = ['Clear', 'Light', 'Moderate', 'Severe'];
const SEVERITY_COLORS = ['#16a34a', '#84cc16', '#f59e0b', '#dc2626'];

function SeverityBadge({ score }: { score: number }) {
  const idx = Math.round(Math.min(3, Math.max(0, score)));
  return (
    <span
      style={{
        background: SEVERITY_COLORS[idx],
        color: 'white',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {SEVERITY_LABELS[idx]} ({score.toFixed(1)})
    </span>
  );
}

function RouteSection({ route }: { route: RouteStatus }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        {route.label} <SeverityBadge score={route.delaySeverityScore} />
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {route.checkpoints.map((cp) => (
          <div
            key={cp.title}
            style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: 'white' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cp.imageUrl}
              alt={cp.title}
              style={{ width: '100%', display: 'block', aspectRatio: '4 / 3', objectFit: 'cover' }}
            />
            <div style={{ padding: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{cp.title}</div>
              <div style={{ fontSize: 12, color: '#555' }}>{cp.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function Page() {
  const state = await getState();

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Commute Copilot</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        {HOME} &rarr; {WORK} &middot; usual leave {USUAL_LEAVE_TIME} AM
      </p>

      {state.recommendation && (
        <div
          style={{
            background: '#eef2ff',
            border: '1px solid #c7d2fe',
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <strong>Latest:</strong> {state.recommendation}
          {state.primary?.updatedAt && (
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              Updated{' '}
              {new Date(state.primary.updatedAt).toLocaleString('en-US', {
                timeZone: 'America/Los_Angeles',
              })}{' '}
              PT
            </div>
          )}
        </div>
      )}

      {state.primary && <RouteSection route={state.primary} />}
      {state.alternate && <RouteSection route={state.alternate} />}

      {!state.primary && <p>No data yet — waiting for the first scheduled check.</p>}
    </main>
  );
}
