import type { MoveReview } from './api/review'
import type { BoardOverlay } from './views/gameShellContext'
import { tryMove } from './chessMove'

// The board's classification badge for a reviewed move — shared by Review's
// walkthrough and Analysis (which reads the same review, never runs one).
export function reviewBadge(move: MoveReview | null): BoardOverlay['badge'] {
  if (!move) return undefined
  const played = tryMove(move.fenBefore, move.san)
  if (!played) return undefined // unparseable ply — no badge, never a crash
  return { square: played.to, classification: move.classification }
}
