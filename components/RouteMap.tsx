'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapCheckpoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  imageUrl: string;
  description?: string;
};

export type MapRoute = {
  key: string;
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'unknown';
  checkpoints: MapCheckpoint[];
};

export type MapPin = {
  lat: number;
  lon: number;
  label: string;
  title?: string;
};

const TONE_COLOR: Record<MapRoute['tone'], string> = {
  good: '#4fd1ae',
  warn: '#e8a33d',
  bad: '#e5484d',
  unknown: '#7c8aa5',
};

export default function RouteMap({
  routes,
  pins = [],
  routeLine,
}: {
  routes: MapRoute[];
  pins?: MapPin[];
  routeLine?: [number, number][];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    // Plain OSM tiles (no API key required), darkened via CSS filter on
    // .leaflet-tile-pane (see globals.css) rather than a keyed dark-tile
    // provider.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const bounds: L.LatLngExpression[] = pins.map((p) => [p.lat, p.lon]);

    if (routeLine && routeLine.length > 1) {
      L.polyline(routeLine, { color: '#e8a33d', weight: 3, opacity: 0.75 }).addTo(map);
      bounds.push(...routeLine);
    }

    // De-dupe checkpoints shared between routes (most I-405 segments appear
    // on both), keeping the first route's tone when shared.
    const seen = new Set<number>();
    for (const route of routes) {
      const color = TONE_COLOR[route.tone];
      for (const cp of route.checkpoints) {
        if (seen.has(cp.id)) continue;
        seen.add(cp.id);
        bounds.push([cp.lat, cp.lon]);

        const icon = L.divIcon({
          className: '',
          html: `<span style="display:block;width:12px;height:12px;border-radius:50%;background:${color};border:2px solid rgba(10,15,28,0.9);box-shadow:0 0 6px ${color}99;"></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });

        const popupHtml = `
          <div style="font-family: var(--font-mono, monospace); font-size: 12px; max-width: 220px;">
            <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(cp.title)}</div>
            <img src="${cp.imageUrl}" data-live-src="${cp.imageUrl}" alt="" style="width:100%; border-radius:4px; margin-bottom:6px; display:block;" />
            <div>${escapeHtml(cp.description ?? 'No read yet')}</div>
          </div>
        `;

        L.marker([cp.lat, cp.lon], { icon }).addTo(map).bindPopup(popupHtml);
      }
    }

    for (const pin of pins) {
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#141c2e;border:2px solid #e8a33d;color:#e8a33d;font:600 10px var(--font-mono, monospace);">${escapeHtml(pin.label)}</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([pin.lat, pin.lon], { icon })
        .addTo(map)
        .bindPopup(escapeHtml(pin.title ?? pin.label));
    }

    if (bounds.length) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    } else {
      map.setView([47.5, -120.5], 7);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only: the parent remounts this component (via a
    // changing `key`) whenever the data set genuinely changes, rather than
    // diffing Leaflet layers in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="route-map" />;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
