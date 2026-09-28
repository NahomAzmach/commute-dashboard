'use client';

import { useState } from 'react';
import Link from 'next/link';
import VerdictPanel from '../components/VerdictPanel';
import FeedGrid from '../components/FeedGrid';
import RouteMapLoader from '../components/RouteMapLoader';
import { toneForScore } from '../lib/severity';
import type { RouteStatus } from '../lib/store';

type ExploreResponse = {
  ok: true;
  route: RouteStatus;
  routeLine: [number, number][];
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
};

type ExploreError = { error: string };

export default function ExplorePage() {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResponse | null>(null);
  const [scanCount, setScanCount] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromQuery.trim() || !toQuery.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromQuery.trim(), to: toQuery.trim() }),
      });
      const data = (await resp.json()) as ExploreResponse | ExploreError;
      if (!resp.ok || !('ok' in data)) {
        setError('error' in data ? data.error : 'Something went wrong scanning that route.');
        setResult(null);
        return;
      }
      setResult(data);
      setScanCount((n) => n + 1);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="hudbar">
        <div className="hudbar-title">
          <span className="live-dot" aria-hidden="true" />
          COMMUTE WATCH
        </div>
        <nav className="hudbar-nav">
          <Link href="/commute" className="hudbar-navlink">
            MY COMMUTE
          </Link>
          <Link href="/" className="hudbar-navlink active">
            EXPLORE A ROUTE
          </Link>
        </nav>
      </div>

      <div className="title-row">
        <div>
          <h1 className="wordmark">Explore a Route</h1>
          <p className="subline">Any two points in Washington State, checked live, right now.</p>
        </div>
      </div>

      <form className="explore-form" onSubmit={handleSubmit}>
        <div className="explore-field">
          <label htmlFor="from">From</label>
          <input
            id="from"
            type="text"
            placeholder="e.g. Tacoma"
            value={fromQuery}
            onChange={(e) => setFromQuery(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="explore-field">
          <label htmlFor="to">To</label>
          <input
            id="to"
            type="text"
            placeholder="e.g. Olympia"
            value={toQuery}
            onChange={(e) => setToQuery(e.target.value)}
            disabled={loading}
          />
        </div>
        <button type="submit" className="explore-submit" disabled={loading}>
          {loading ? 'SCANNING…' : 'SCAN ROUTE'}
        </button>
      </form>

      {error && <div className="explore-error">{error}</div>}

      {loading && (
        <div className="empty-state">
          <strong>READING LIVE CAMERAS</strong>
          Finding WSDOT cameras along that route and asking the model what it sees. Takes a
          few seconds.
        </div>
      )}

      {!loading && !error && !result && (
        <div className="empty-state">
          <strong>PICK A ROUTE</strong>
          Type a start and end point anywhere in Washington State. We&apos;ll find the
          nearest WSDOT highway cameras along the way and check them live - nothing saved,
          nothing scheduled, just a one-off read on how it looks right now.
        </div>
      )}

      {result && (
        <>
          <VerdictPanel
            score={result.route.delaySeverityScore}
            headline={result.route.summary}
            detail={`${result.from.label} → ${result.to.label}`}
            updatedAtISO={result.route.updatedAt}
          />

          <section className="map-section">
            <RouteMapLoader
              key={scanCount}
              routes={[
                {
                  key: 'explore',
                  label: result.route.label,
                  tone: toneForScore(result.route.delaySeverityScore),
                  checkpoints: result.route.checkpoints,
                },
              ]}
              pins={[
                { lat: result.from.lat, lon: result.from.lon, label: 'A', title: result.from.label },
                { lat: result.to.lat, lon: result.to.lon, label: 'B', title: result.to.label },
              ]}
              routeLine={result.routeLine}
            />
          </section>

          <FeedGrid
            label={result.route.label}
            index={1}
            score={result.route.delaySeverityScore}
            checkpoints={result.route.checkpoints}
          />
        </>
      )}

      <div className="foot">
        Live stills served directly from images.wsdot.wa.gov &middot; congestion calls from
        Gemini 2.5 Flash-Lite via Vercel AI Gateway &middot; routing via OSRM &middot; geocoding
        via OpenStreetMap Nominatim &middot; limited to 5 scans per 10 minutes per visitor
      </div>
    </main>
  );
}
