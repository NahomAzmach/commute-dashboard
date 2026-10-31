'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type CameraInsight = {
  cameraId: number;
  title: string;
  imageUrl: string;
  corridor: string;
  condition: string;
  previousCondition: string | null;
  previousTimestamp: number | null;
  change: number | null;
  flowLabel: string | null;
  travelRatio: number | null;
  incident: boolean;
  timestamp: number;
};

type QueryResponse = {
  hours: number;
  analyzedCameraCount: number;
  corridors: {
    name: string;
    cameraCount: number;
    incidents: number;
    severity: number;
  }[];
  results: CameraInsight[];
  error?: string;
};

const PRESETS = [
  { label: 'Worst right now', query: 'worst traffic' },
  { label: 'Congestion', query: 'congestion' },
  { label: 'Incidents', query: 'incidents' },
  { label: 'Seattle congestion', query: 'congestion near Seattle' },
];

export default function CameraInsightSearch() {
  const [query, setQuery] = useState('worst traffic');
  const [hours, setHours] = useState('3');
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(async (nextQuery: string, nextHours: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: nextQuery, hours: nextHours });
      const resp = await fetch(`/api/camera-insights?${params.toString()}`);
      const data = (await resp.json()) as QueryResponse;
      if (!resp.ok) throw new Error(data.error ?? `Query failed (${resp.status})`);
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not query camera observations.');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runQuery('worst traffic', '3');
  }, [runQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery(query, hours);
  }

  function applyPreset(nextQuery: string) {
    setQuery(nextQuery);
    void runQuery(nextQuery, hours);
  }

  return (
    <section className="camera-insights route-section" aria-labelledby="camera-insights-title">
      <div className="route-heading">
        <span className="route-index">ML</span>
        <h2 className="route-name" id="camera-insights-title">
          Query recent camera reads
        </h2>
      </div>
      <p className="camera-insights-copy">
        Search recent vision labels and cross-check them against WSDOT flow and travel-time
        signals. Example: &quot;worst congestion near Seattle&quot;. Corridor names are inferred from
        camera titles; city cameras are grouped by nearby area.
      </p>

      <form className="camera-query-form" onSubmit={submit}>
        <label className="camera-query-label" htmlFor="camera-query">
          Ask about traffic
        </label>
        <div className="camera-query-controls">
          <input
            id="camera-query"
            className="camera-query-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. stopped traffic near Tacoma"
            maxLength={120}
          />
          <label className="camera-hours-label" htmlFor="camera-hours">
            Window
          </label>
          <select
            id="camera-hours"
            className="camera-hours-select"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          >
            <option value="1">Last hour</option>
            <option value="3">Last 3 hours</option>
            <option value="6">Last 6 hours</option>
            <option value="12">Last 12 hours</option>
            <option value="24">Last 24 hours</option>
          </select>
          <button className="camera-query-button" type="submit" disabled={loading}>
            {loading ? 'SEARCHING...' : 'QUERY'}
          </button>
        </div>
        <div className="camera-query-presets" aria-label="Suggested queries">
          {PRESETS.map((preset) => (
            <button
              className="camera-query-preset"
              type="button"
              key={preset.label}
              onClick={() => applyPreset(preset.query)}
              disabled={loading}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </form>

      <p className="camera-query-note">
        Ranked using the strongest available evidence: Gemini vision label, nearby sensor reading,
        travel-time ratio and incident flag. Only recently analyzed cameras can appear; this is not
        yet a trained student model. Pictures are current camera stills, not archived copies of
        analyzed frames. Frame difference can reflect lighting changes, so treat it as supporting
        evidence.
      </p>

      {error && (
        <p className="camera-query-error" role="alert">
          {error}
        </p>
      )}

      {response && (
        <>
          <p className="camera-query-summary" aria-live="polite">
            {response.results.length
              ? `Showing ${response.results.length} matches from ${response.analyzedCameraCount} recently analyzed cameras in the last ${response.hours}h.`
              : `No matching camera reads found in the last ${response.hours}h across ${response.analyzedCameraCount} recently analyzed cameras.`}
          </p>
          {response.corridors.length > 0 && (
            <div className="corridor-rank-list">
              <p className="corridor-rank-heading">Corridors ranked by strongest signal</p>
              <div className="corridor-rank-grid">
                {response.corridors.map((corridor, index) => (
                  <div className="corridor-rank-card" key={corridor.name}>
                    <span className="corridor-rank-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <strong>{corridor.name}</strong>
                      <p>
                        {corridor.cameraCount} camera{corridor.cameraCount === 1 ? '' : 's'} &middot;{' '}
                        top score {corridor.severity.toFixed(1)}
                        {corridor.incidents > 0
                          ? `; ${corridor.incidents} nearby incident${corridor.incidents === 1 ? '' : 's'}`
                          : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {response.results.length > 0 && (
            <div className="camera-insight-grid">
              {response.results.map((camera) => {
                const imageUrl = new URL(camera.imageUrl);
                imageUrl.searchParams.set('t', String(Date.now()));
                const minutesBetween =
                  camera.previousTimestamp === null
                    ? null
                    : Math.max(
                        1,
                        Math.round((camera.timestamp - camera.previousTimestamp) / 60000),
                      );
                return (
                  <article className="camera-insight-card" key={camera.cameraId}>
                    <a
                      className="camera-insight-image"
                      href={camera.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open current image for ${camera.title}`}
                    >
                      <img
                        src={imageUrl.toString()}
                        alt={`Current live still, not the archived analysis frame: ${camera.title}`}
                        loading="lazy"
                      />
                      <span className="camera-live-still">CURRENT STILL</span>
                    </a>
                    <div className="camera-insight-content">
                      <div className="camera-insight-title-row">
                        <h3>{camera.title}</h3>
                        <span className={`camera-condition condition-${camera.condition}`}>
                          {camera.condition}
                        </span>
                      </div>
                      <p className="camera-insight-meta">
                        {camera.corridor} &middot; Analyzed{' '}
                        {new Date(camera.timestamp).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                      <div className="camera-signal-list">
                        {camera.previousCondition && (
                          <span>
                            {camera.previousCondition === camera.condition
                              ? 'Vision read unchanged'
                              : `Changed ${camera.previousCondition} to ${camera.condition}${
                                  minutesBetween ? ` (${minutesBetween}m later)` : ''
                                }`}
                          </span>
                        )}
                        {camera.change !== null && (
                          <span>Frame diff: {Math.round(camera.change * 100)}%</span>
                        )}
                        {camera.flowLabel && <span>Sensor: {camera.flowLabel}</span>}
                        {camera.travelRatio !== null && (
                          <span>Travel time: {camera.travelRatio.toFixed(2)}x typical</span>
                        )}
                        {camera.incident && <span className="camera-incident">Incident nearby</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
