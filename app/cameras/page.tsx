import Link from 'next/link';
import { getWsdotCatalog } from '../../lib/wsdot';
import { getSeattleCameraCatalog } from '../../lib/seattleCams';
import AllCamerasMapLoader from '../../components/AllCamerasMapLoader';
import type { BrowseCamera } from '../../components/AllCamerasMap';
import { lynnwoodCameras } from '../../lib/lynnwoodCams';

export const dynamic = 'force-dynamic';

export default async function AllCamerasPage() {
  const [wsdotCameras, seattleCameras] = await Promise.all([
    getWsdotCatalog(),
    getSeattleCameraCatalog().catch(() => []),
  ]);

  const cameras: BrowseCamera[] = [
    ...wsdotCameras.map((c) => ({ ...c, source: 'wsdot' as const })),
    ...seattleCameras.map((c) => ({ ...c, source: 'seattle' as const })),
  ];

  return (
    <main className="shell">
      <div className="hudbar">
        <div className="hudbar-title">
          <span className="live-dot" aria-hidden="true" />
          COMMUTE WATCH
        </div>
        <nav className="hudbar-nav">
          <Link href="/commute" className="hudbar-navlink">
            MY COMMUTE
          </Link>
          <Link href="/" className="hudbar-navlink">
            EXPLORE A ROUTE
          </Link>
          <Link href="/cameras" className="hudbar-navlink active">
            ALL CAMERAS
          </Link>
        </nav>
      </div>

      <div className="title-row">
        <div>
          <h1 className="wordmark">All Cameras</h1>
          <p className="subline">
            Every camera on file, statewide - {cameras.length.toLocaleString()} total. Click a
            pin for a live still. No AI read here, just raw browsing.
          </p>
        </div>
      </div>

      <div className="map-legend">
        <span>
          <span className="map-legend-dot" style={{ background: '#4fd1ae' }} />
          WSDOT ({wsdotCameras.length.toLocaleString()})
        </span>
        <span>
          <span className="map-legend-dot" style={{ background: '#e8a33d' }} />
          Seattle DOT ({seattleCameras.length.toLocaleString()})
        </span>
        <span>
          <span className="map-legend-dot" style={{ background: '#60a5fa' }} />
          Lynnwood ({lynnwoodCameras.length})
        </span>
      </div>

      <AllCamerasMapLoader cameras={cameras} />

      <div className="foot">
        Camera locations + stills from WSDOT&apos;s Highway Cameras API and Seattle&apos;s
        ArcGIS open-data feature service &middot; refreshed every 6 hours &middot; images load
        on click, nothing pre-fetched
      </div>
    </main>
  );
}
