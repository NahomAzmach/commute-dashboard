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
