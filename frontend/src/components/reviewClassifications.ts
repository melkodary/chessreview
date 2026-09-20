import type { Classification } from '../api/review'

// Scoreboard order — shared by ReviewSummary and ReviewScoreboardSkeleton so the
// skeleton's row scaffold stays a pixel-match of the real scoreboard (the spec's
// "swap, not relayout" contract). Keep order + labels in one place to prevent drift.
export const CLASS_ORDER: Classification[] = [
  'brilliant', 'great', 'book', 'best', 'excellent', 'good',
  'inaccuracy', 'mistake', 'miss', 'blunder',
]

export const CLASS_LABEL: Record<Classification, string> = {
  brilliant: 'Brilliant',
  great: 'Critical',
  book: 'Book',
  forced: 'Forced',
  best: 'Best',
  excellent: 'Solid',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Missed',
  blunder: 'Blunder',
}

// Icons in the move list are reserved for moves worth looking at. book / best /
// excellent / good are the "you did fine" labels — the bulk of a game — and stamping
// them buries the six that matter.
export const SPECIAL_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  'brilliant', 'great', 'miss', 'inaccuracy', 'mistake', 'blunder',
])
