export type Tone = 'good' | 'warn' | 'bad';

export function toneForScore(score: number): Tone {
  if (score < 1) return 'good';
  if (score < 3) return 'warn';
  return 'bad';
}

export function headlineForScore(score: number): string {
  if (score < 1) return 'GO NOW — ROUTE CLEAR';
  if (score < 2) return 'MINOR DELAYS';
  if (score < 3) return 'HEAVY TRAFFIC BUILDING';
  return 'SEVERE — HOLD OR REROUTE';
}

const SEVERITY_WORDS = ['CLEAR', 'LIGHT', 'MODERATE', 'SEVERE'];

export function severityWord(score: number) {
  return SEVERITY_WORDS[Math.round(Math.min(3, Math.max(0, score)))];
}

/** Trims a checkpoint title down to the part before any parenthetical note
 * ("I-405 at MP 20.6: NE 128th St (Totem Lake/Kirkland)" -> "I-405 at MP
 * 20.6: NE 128th St"), which is usually specific enough to place it. */
function shortTitle(title: string): string {
  return title.split(' (')[0];
}

export type ConditionSummaryInput = { title: string; condition: string | null };

/**
 * A short, specific, free summary built entirely from the already-computed
 * per-checkpoint conditions - no extra model call. Says exactly which
 * checkpoint(s) are the problem instead of a generic severity label, so a
 * single isolated flag reads as "congestion at X, rest clear" rather than a
 * blanket "severe" that implies the whole route is bad.
 */
export function summarizeConditions(checkpoints: ConditionSummaryInput[]): string {
  const bad = checkpoints.filter((c) => c.condition === 'congested' || c.condition === 'stopped');
  const slow = checkpoints.filter((c) => c.condition === 'slow');

  if (bad.length === 0 && slow.length === 0) {
    return `All ${checkpoints.length} checkpoints clear.`;
  }
  if (bad.length === 0) {
    return `Minor slowdown near ${shortTitle(slow[0].title)}, rest clear.`;
  }
  if (bad.length === 1) {
    const word = bad[0].condition === 'stopped' ? 'Stopped traffic' : 'Congestion';
    return `${word} at ${shortTitle(bad[0].title)}, rest of route clear.`;
  }
  const names = bad
    .slice(0, 2)
    .map((c) => shortTitle(c.title))
    .join(' and ');
  const extra = bad.length > 2 ? ` (+${bad.length - 2} more)` : '';
  return `Congestion at ${bad.length} points: ${names}${extra}.`;
}
