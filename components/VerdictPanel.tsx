import { toneForScore } from '../lib/severity';

export default function VerdictPanel({
  score,
  headline,
  detail,
  updatedAtISO,
}: {
  score: number;
  headline: string;
  detail?: string;
  updatedAtISO: string;
}) {
  return (
    <div className="verdict">
      <div className="verdict-eyebrow">Current call</div>
      <h2 className={`verdict-headline tone-${toneForScore(score)}`}>{headline}</h2>
      {detail && <p className="verdict-detail">{detail}</p>}
      <div className="verdict-meta">
        LAST SWEEP{' '}
        {new Date(updatedAtISO)
          .toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
            day: 'numeric',
          })
          .toUpperCase()}{' '}
        PT
      </div>
    </div>
  );
}
