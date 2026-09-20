import type { MoveReview, ReviewSummary, SideSummary } from './api/review'

// White plays odd plies, Black even. Accuracy stays null until final summary.
export function partialSummary(moves: MoveReview[]): ReviewSummary {
  const blank = (): SideSummary => ({ accuracy: null, counts: {}, biggestBlunderPly: null })
  const white = blank(), black = blank()
  for (const m of moves) {
    const side = m.ply % 2 === 1 ? white : black
    side.counts[m.classification] = (side.counts[m.classification] ?? 0) + 1
  }
  return { white, black, keyMoments: [], opening: null }
}
