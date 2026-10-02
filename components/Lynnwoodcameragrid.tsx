import { lynnwoodCameras } from '../lib/lynnwoodCams';

export default function LynnwoodCameraGrid() {
  return (
    <section className="route-section">
      <div className="route-heading">
        <span className="route-index">LW</span>
        <h2 className="route-name">Lynnwood Live Cameras</h2>
      </div>

      <div className="feed-grid">
        {lynnwoodCameras.map((camera, index) => (
          <div className="feed-tile" key={camera.id}>
            <div className="feed-frame">
              <iframe
                src={camera.iframeUrl}
                title={`Lynnwood traffic camera: ${camera.name}`}
                loading="lazy"
                allow="autoplay; fullscreen"
                allowFullScreen
                style={{
                  width: '100%',
                  height: '100%',
                  border: 0,
                }}
              />

              <span className="feed-index">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>

            <div className="feed-caption">
              <p className="feed-title">{camera.name}</p>
              <p className="feed-desc">Live Lynnwood traffic camera</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
