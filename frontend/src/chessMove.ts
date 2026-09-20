import { Chess } from 'chess.js'
import type { Move } from 'chess.js'

// Apply a SAN move to a FEN, returning the resulting Move (carrying from/to), or
// null when the SAN is illegal/stale for that position. Shared by reviewArrows
// and reviewBadge — both parse a played/best move off a review row's fenBefore
// and must never crash on an unparseable ply.
export function tryMove(fen: string, san: string): Move | null {
  try {
    return new Chess(fen).move(san)
  } catch {
    return null
  }
}
