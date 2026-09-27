'use client';

import dynamic from 'next/dynamic';
import type { MapRoute } from './RouteMap';

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <div className="route-map route-map-loading">LOADING MAP…</div>,
});

export default function RouteMapLoader(props: {
  routes: MapRoute[];
  home: { lat: number; lon: number };
  work: { lat: number; lon: number };
}) {
  return <RouteMap {...props} />;
}
