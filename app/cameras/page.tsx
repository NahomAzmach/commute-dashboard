import Link from 'next/link';
import { getWsdotCatalog } from '../../lib/wsdot';
import { getSeattleCameraCatalog } from '../../lib/seattleCams';
import AllCamerasMapLoader from '../../components/AllCamerasMapLoader';
import LynnwoodCameraGrid from '../../components/LynnwoodCameraGrid';
import CameraInsightSearch from '../../components/CameraInsightSearch';
import CameraArchiveSearch from '../../components/CameraArchiveSearch';
import type { BrowseCamera } from '../../components/AllCamerasMap';
import { lynnwoodCameras } from '../../lib/lynnwoodCams';

export const dynamic = 'force-dynamic';

export default async function AllCamerasPage() {
  const [wsdotCameras, seattleResult] = await Promise.all([
    getWsdotCatalog(),
    getSeattleCameraCatalog().then(
      (cameras) => ({ cameras, error: null }),
      (error: unknown) => ({
        cameras: [],
        error: error instanceof Error ? error.message : 'Seattle camera catalog unavailable',
      }),
    ),
  ]);
  const { cameras: seattleCameras, error: seattleError } = seattleResult;

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
            Explore {cameras.length.toLocaleString()} WSDOT and Seattle DOT cameras across
            Washington, focused on Puget Sound. Query recent AI reads below.
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
          Seattle DOT{' '}
          {seattleError ? '(unavailable)' : `(${seattleCameras.length.toLocaleString()})`}
        </span>
        <span>
          <span className="map-legend-dot" style={{ background: '#60a5fa' }} />
          Lynnwood ({lynnwoodCameras.length})
        </span>
      </div>
      {seattleError && (
        <p className="explore-error" role="status">
          Seattle DOT cameras couldn&apos;t be loaded: {seattleError}
        </p>
      )}

      <AllCamerasMapLoader cameras={cameras} />

      <CameraInsightSearch />

      <CameraArchiveSearch />

      <LynnwoodCameraGrid />

      <div className="foot">
        Camera locations + stills from WSDOT&apos;s Highway Cameras API and Seattle&apos;s
        official camera services. Historical image matches come only from frames explicitly saved
        by a user; the other camera feeds remain current-only. Lynnwood feeds are embedded below.
      </div>
    </main>
  );
}
