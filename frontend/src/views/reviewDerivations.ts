import { useMemo } from 'react'
import type { MoveReview } from '../api/review'

// Derived-state shared by the Review and Analysis panels — both annotate the
// same move list and badge the same reviewed move, so the derivations live once.

// ply → classification, for MoveList's per-move icons.
export function useReviewMap(moves: MoveReview[]): Map<number, MoveReview['classification']> {
  return useMemo(() => new Map(moves.map((m) => [m.ply, m.classification])), [moves])
}

// This ply's review row, or null when the ply has no review (out of range, or a
// branch position with no game-line data).
export function useCurrentReview(moves: MoveReview[], ply: number): MoveReview | null {
  return useMemo(() => moves.find((m) => m.ply === ply) ?? null, [moves, ply])
}
