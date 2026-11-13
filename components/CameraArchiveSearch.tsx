'use client';

import { FormEvent, useState } from 'react';

type ArchiveMatch = {
  cameraId: number;
  source: 'wsdot' | 'seattle';
  title: string;
  lat: number;
  lon: number;
  firstSeenAt: string;
  lastSeenAt: string;
  similarity: number;
  imageUrl: string;
};

type SearchResponse = {
  query: string;
  hours: number;
  results: ArchiveMatch[];
  error?: string;
};

const PRESETS = [
  'stop-and-go traffic',
  'heavy traffic with long queues',
  'clear, free-flowing highway',
  'rain or low visibility',
];

export default function CameraArchiveSearch() {
  const [query, setQuery] = useState('stop-and-go traffic');
  const [hours, setHours] = useState('24');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(searchText: string, searchHours: string) {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const result = await fetch('/api/camera-archive/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchText, hours: searchHours }),
      });
      const data = (await result.json()) as SearchResponse;
      if (!result.ok) throw new Error(data.error ?? `Search failed (${result.status})`);
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search archived camera moments.');
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query, hours);
  }

  function applyPreset(preset: string) {
    setQuery(preset);
    void runSearch(preset, hours);
  }

  return (
    <section className="camera-archive-search route-section" aria-labelledby="camera-archive-title">
      <div className="route-heading">
        <span className="route-index">VEC</span>
        <h2 className="route-name" id="camera-archive-title">
          Search saved traffic moments
        </h2>
      </div>
      <p className="camera-insights-copy">
        Describe a scene in plain language. EmbeddingGemma 2 compares your text with only the camera
        images you have explicitly saved; it does not continuously process every feed.
      </p>

      <form className="camera-archive-form" onSubmit={submit}>
        <label className="camera-query-label" htmlFor="archive-search-query">
          Find a moment
        </label>
        <div className="camera-query-controls">
          <input
            id="archive-search-query"
            className="camera-query-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. backed-up traffic in heavy rain"
            maxLength={200}
            required
          />
          <label className="camera-hours-label" htmlFor="archive-query-hours">
            Window
          </label>
          <select
            id="archive-query-hours"
            className="camera-hours-select"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          >
            <option value="1">Last hour</option>
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
          </select>
          <button className="camera-query-button" type="submit" disabled={loading}>
            {loading ? 'SEARCHING...' : 'SEARCH'}
          </button>
        </div>
        <div className="camera-query-presets" aria-label="Suggested searches">
          {PRESETS.map((preset) => (
            <button
              className="camera-query-preset"
              type="button"
              key={preset}
              onClick={() => applyPreset(preset)}
              disabled={loading}
            >
              {preset}
            </button>
          ))}
        </div>
      </form>

      <p className="camera-query-note">
        Search results only include archived snapshots. A dot click shows the live image; choose
        &quot;Save and index this moment&quot; to store and vectorize that one camera frame. Similarity
        scores rank results; they are not probabilities.
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
              ? `Found ${response.results.length} saved moment${response.results.length === 1 ? '' : 's'} related to “${response.query}” in the last ${response.hours}h.`
              : `No saved moments matched “${response.query}” in the last ${response.hours}h.`}
          </p>
          {response.results.length > 0 && (
            <div className="camera-insight-grid">
              {response.results.map((match) => (
                <article
                  className="camera-insight-card"
                  key={`${match.source}-${match.cameraId}-${match.firstSeenAt}`}
                >
                  <a
                    className="camera-insight-image"
                    href={match.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open archived frame from ${match.title}`}
                  >
                    <img
                      src={match.imageUrl}
                      alt={`Archived camera frame: ${match.title}`}
                      loading="lazy"
                    />
                    <span className="camera-live-still">ARCHIVED MOMENT</span>
                  </a>
                  <div className="camera-insight-content">
                    <div className="camera-insight-title-row">
                      <h3>{match.title}</h3>
                      <span className="camera-condition">
                        {Math.round(match.similarity * 100)}% similar
                      </span>
                    </div>
                    <p className="camera-insight-meta">
                      {match.source.toUpperCase()} &middot;{' '}
                      {new Date(match.firstSeenAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {match.lastSeenAt !== match.firstSeenAt &&
                        ` – ${new Date(match.lastSeenAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}`}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
