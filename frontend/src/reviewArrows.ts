import type { Arrow } from 'react-chessboard'
import type { MoveReview } from './api/review'
import { tryMove } from './chessMove'

/**
 * The best move as a single arrow ("what should have been played").
 * We intentionally do NOT draw the played move — an arrow on the move you
 * actually made reads as a threat/attack indicator (chess.com semantics) and
 * is confusing. The played square is already marked by the classification badge.
 */
export function reviewArrows(m: MoveReview, bestColor: string): Arrow[] {
  const move = tryMove(m.fenBefore, m.bestMoveSan)
  if (!move) return [] // illegal/stale SAN for this position
  return [{ startSquare: move.from, endSquare: move.to, color: bestColor }]
}
