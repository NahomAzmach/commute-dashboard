import SeverityMeter from './SeverityMeter';
import { severityWord } from '../lib/severity';

export type FeedCheckpoint = {
  title: string;
  imageUrl: string;
  description: string;
};

export default function FeedGrid({
  label,
  index,
  score,
  checkpoints,
}: {
  label: string;
  index: number;
  score: number;
  checkpoints: FeedCheckpoint[];
}) {
  return (
    <section className="route-section">
      <div className="route-heading">
        <span className="route-index">{String(index).padStart(2, '0')}</span>
        <h2 className="route-name">{label}</h2>
        <SeverityMeter score={score} label={severityWord(score)} />
      </div>
      <div className="feed-grid">
        {checkpoints.map((cp, i) => (
          <div className="feed-tile" key={cp.title}>
            <div className="feed-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cp.imageUrl} data-live-src={cp.imageUrl} alt={cp.title} loading="lazy" />
              <span className="feed-index">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="feed-caption">
              <p className="feed-title">{cp.title}</p>
              <p className="feed-desc">{cp.description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
