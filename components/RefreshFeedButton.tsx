'use client';

import { useState } from 'react';

export default function RefreshFeedButton() {
  const [state, setState] = useState<'idle' | 'done'>('idle');

  function handleClick() {
    const images = document.querySelectorAll<HTMLImageElement>('img[data-live-src]');
    images.forEach((img) => {
      const base = img.getAttribute('data-live-src');
      if (!base) return;
      const url = new URL(base, window.location.href);
      url.searchParams.set('t', Date.now().toString());
      img.src = url.toString();
    });
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
