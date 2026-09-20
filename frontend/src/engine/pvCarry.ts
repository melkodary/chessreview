import { Chess } from 'chess.js'
import type { AnalysisLine } from '../api/analyzer'

/** The four FEN fields carrying positional identity. Halfmove/fullmove counters
 *  are excluded — they differ between equivalent arrivals at one position. */
function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ')
}

/** A mate score advanced one ply along its own mating line. White-relative and
 *  counted in *moves*, so it never carries verbatim — a parent's M5 is the
 *  child's M4. Null when the ply played *is* the mate (nothing follows). */
export function mateAfterPly(mate: number, whiteToMoveBefore: boolean): number | null {
  const matingSideIsWhite = mate > 0
  const plies = 2 * Math.abs(mate) - (whiteToMoveBefore === matingSideIsWhite ? 1 : 0)
  const pliesAfter = plies - 1
  if (pliesAfter <= 0) return null
  // Side to move after the ply is the opposite of the side to move before it.
  const magnitude = (pliesAfter + (!whiteToMoveBefore === matingSideIsWhite ? 1 : 0)) / 2
  return matingSideIsWhite ? magnitude : -magnitude
}

/** Play a displayed line's first move and its tail is already a valid PV for the
 *  new position. Matching by replay — not by navigation semantics — is what lets
 *  one path cover forward nav, a MoveList click, and branch exploration. */
export function carryLines(
  prevFen: string,
  prevLines: AnalysisLine[],
  nextFen: string,
): { lines: AnalysisLine[]; matchIndex: number } | null {
  const target = positionKey(nextFen)
  const whiteToMoveBefore = prevFen.trim().split(/\s+/)[1] === 'w'

  for (let i = 0; i < prevLines.length; i++) {
    const matched = prevLines[i]
    const san = matched.moves[0]
    if (!san) continue

    let reached: string
    try {
      const chess = new Chess(prevFen)
      chess.move(san)
      reached = positionKey(chess.fen())
    } catch {
      continue // illegal/stale SAN for this position — not a match
    }
    if (reached !== target) continue

    const moves = matched.moves.slice(1)
    if (moves.length === 0) return null

    let mate: number | null = null
    if (matched.mate != null) {
      mate = mateAfterPly(matched.mate, whiteToMoveBefore)
      if (mate === null) return null
    }

    // `evaluation` (including the ±MATE_SENTINEL) is white-relative, so
    // advancing one ply along the line changes neither its sign nor its meaning.
    const carried: AnalysisLine = { moves, evaluation: matched.evaluation, mate }
    if (matched.pvUci) carried.pvUci = matched.pvUci.slice(1)

    return { lines: [carried, ...prevLines.filter((_, j) => j !== i)], matchIndex: i }
  }
  return null
}
