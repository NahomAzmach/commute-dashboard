'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

export type BrowseCamera = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
  source: 'wsdot' | 'seattle';
};

const SOURCE_COLOR: Record<BrowseCamera['source'], string> = {
  wsdot: '#4fd1ae',
  seattle: '#e8a33d',
};

/**
 * Pure browse view of every camera on file - no AI read, no live check,
 * just location + a live still on click. Markers are clustered since this
 * is ~2,000 points at once; images only load when a popup is actually
 * opened (Leaflet doesn't render bound popup content into the DOM until
 * then), so this never fires 2,000 image requests up front.
 */
export default function AllCamerasMap({ cameras }: { cameras: BrowseCamera[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });

    for (const cam of cameras) {
      const color = SOURCE_COLOR[cam.source];
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:block;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid rgba(10,15,28,0.9);"></span>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });

      const popupHtml = `
        <div style="font-family: var(--font-mono, monospace); font-size: 12px; max-width: 220px;">
          <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(cam.title)}</div>
          <img src="${cam.imageUrl}" data-live-src="${cam.imageUrl}" alt="" style="width:100%; border-radius:4px; display:block;" />
        </div>
      `;

      L.marker([cam.lat, cam.lon], { icon }).addTo(clusterGroup).bindPopup(popupHtml);
    }

    clusterGroup.addTo(map);

    // Re-fetch the image fresh every time a popup is opened, rather than
    // showing whatever the browser happened to cache from a prior visit.
    map.on('popupopen', (e) => {
      const img = e.popup.getElement()?.querySelector<HTMLImageElement>('img[data-live-src]');
      if (!img) return;
      const base = img.getAttribute('data-live-src');
      if (!base) return;
      const url = new URL(base, window.location.href);
      url.searchParams.set('t', Date.now().toString());
      img.src = url.toString();
    });

    map.setView([47.5, -121.5], 7);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="route-map all-cameras-map" />;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
