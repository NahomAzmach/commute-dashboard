'use client';

import dynamic from 'next/dynamic';
import type { MapRoute, MapPin } from './RouteMap';

const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <div className="route-map route-map-loading">LOADING MAP…</div>,
});

export default function RouteMapLoader(props: {
  routes: MapRoute[];
  pins?: MapPin[];
  routeLine?: [number, number][];
}) {
  return <RouteMap {...props} />;
}
