/**
 * Cache-busts every live camera `<img>` on the page by rewriting its src
 * with a fresh timestamp query param. These are periodically-refreshed
 * stills (WSDOT/Seattle), not video streams, so "going live" just means
 * re-fetching the same URL rather than opening any kind of stream.
 */
export function refreshLiveImages(): void {
  const images = document.querySelectorAll<HTMLImageElement>('img[data-live-src]');
  images.forEach((img) => {
    const base = img.getAttribute('data-live-src');
    if (!base) return;
    const url = new URL(base, window.location.href);
    url.searchParams.set('t', Date.now().toString());
    img.src = url.toString();
  });
}
