import type { MoveReview } from './api/review'
import type { BranchGrade } from './hooks/useBranchReview'

export interface EvalBarValue {
  evaluation: number
  mate: number | null
}

export function evalBarFromReview(
  current: MoveReview | null,
  moves: MoveReview[],
): EvalBarValue | null {
  if (current) return { evaluation: current.evalAfterPlayed, mate: current.mateAfterPlayed }
  const first = moves[0]
  return first ? { evaluation: first.evalBefore, mate: first.mateBefore } : null
}

// Branch-sourced eval bar while exploring on Review. Mirrors ReviewPanel's
// branchBadge indexing convention (j = branchIndex - 1). branchIndex 0 is the
// fork — a game position, not a branch one — so it is not handled here;
// callers fall back to evalBarFromReview for it. Pure: a pending/error/missing
// grade returns null, and freezing (holding the last shown value across those)
// is the caller's job, not this function's.
export function branchEvalBar(grades: BranchGrade[], branchIndex: number): EvalBarValue | null {
  if (branchIndex < 1) return null
  const grade = grades[branchIndex - 1]
  if (!grade || grade.status !== 'done' || !grade.review) return null
  return { evaluation: grade.review.evalAfterPlayed, mate: grade.review.mateAfterPlayed }
}
