'use client';

import dynamic from 'next/dynamic';
import type { BrowseCamera } from './AllCamerasMap';

const AllCamerasMap = dynamic(() => import('./AllCamerasMap'), {
  ssr: false,
  loading: () => <div className="route-map all-cameras-map route-map-loading">LOADING MAP…</div>,
});

export default function AllCamerasMapLoader(props: { cameras: BrowseCamera[] }) {
  return <AllCamerasMap {...props} />;
}
