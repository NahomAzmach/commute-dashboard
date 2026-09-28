import { toneForScore } from '../lib/severity';

export default function SeverityMeter({ score, label }: { score: number; label: string }) {
  const idx = Math.round(Math.min(3, Math.max(0, score)));
  const tone = toneForScore(score);
  const litClass = tone === 'good' ? 'lit-good' : tone === 'warn' ? 'lit-warn' : 'lit-bad';
  return (
    <>
      <span className="severity-label">{label}</span>
      <span className="severity-meter" aria-hidden="true">
        {[0, 1, 2, 3].map((bar) => (
          <span key={bar} className={`severity-bar${bar <= idx ? ` ${litClass}` : ''}`} />
        ))}
      </span>
    </>
  );
}
