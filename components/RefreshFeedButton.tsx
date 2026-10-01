'use client';

import { useEffect, useState } from 'react';
import { refreshLiveImages } from '../lib/refreshImages';

const AUTO_REFRESH_MS = 20000;

export default function RefreshFeedButton() {
  const [state, setState] = useState<'idle' | 'done'>('idle');

  // Auto-refresh on a timer so the feed feels live without a click - same
  // cache-busting as the manual button, just on a schedule.
  useEffect(() => {
    const id = window.setInterval(refreshLiveImages, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  function handleClick() {
    refreshLiveImages();
    setState('done');
    window.setTimeout(() => setState('idle'), 1500);
  }

  return (
    <button type="button" className="refresh-btn" onClick={handleClick}>
      <span className={`refresh-icon${state === 'done' ? ' spin-once' : ''}`} aria-hidden="true">
        &#8635;
      </span>
      {state === 'done' ? 'FEED REFRESHED' : 'REFRESH FEED'}
    </button>
  );
}
