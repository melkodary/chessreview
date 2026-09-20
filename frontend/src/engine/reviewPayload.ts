import { Chess } from 'chess.js'
import type { AnalysisLine, GradeLine, GradeMoveEval } from '../api/analyzer'
import { getEval, type CachedPosition } from './evalCache'

// White-POV cp/mate for the backend classifier, from a white-POV AnalysisLine.
export function scoreOf(line: AnalysisLine): GradeMoveEval {
  return line.mate != null ? { mate: line.mate } : { cp: Math.round(line.evaluation * 100) }
}

// Reconstruct the backend before_lines payload from a cached before-position:
// each line needs its move (pvUci[0]) and a score. Null below `minLines` usable
// lines — the one-ply grader needs 2 (after_second); a whole-game payload sends
// what the search found and lets the backend judge a forced ply.
export function beforeLinesFrom(pos: CachedPosition, minLines = 2): GradeLine[] | null {
  const out: GradeLine[] = []
  for (const l of pos.lines) {
    const uci = l.pvUci?.[0]
    if (!uci) return null
    out.push({ uci, ...scoreOf(l) })
  }
  return out.length >= minLines ? out : null
}

export function isTerminalFen(fen: string): boolean {
  try {
    return new Chess(fen).isGameOver()
  } catch {
    return false
  }
}

// One ply of the whole-game eval payload (POST /reviews `plies`). Eval-shaped
// only — no field a label could travel in.
export interface ReviewPly {
  fenBefore: string
  fenAfter: string
  beforeLines: GradeLine[]
  afterEval?: GradeMoveEval
}

// Assemble every ply's evals from the cache after a whole-game sweep at
// `depth`/`multipv`. Null when any position is missing (never searched, or
// evicted by a long game) — the caller then submits without a payload and the
// backend searches. Book plies are sent too: only the backend knows the book.
export function buildReviewPayload(
  positions: { fen: string }[], depth: number, multipv: number,
): ReviewPly[] | null {
  const plies: ReviewPly[] = []
  for (let ply = 1; ply < positions.length; ply++) {
    const before = getEval(positions[ply - 1].fen, multipv, depth)
    const beforeLines = before ? beforeLinesFrom(before, 1) : null
    if (!beforeLines) return null
    const fenAfter = positions[ply].fen
    if (isTerminalFen(fenAfter)) {
      plies.push({ fenBefore: positions[ply - 1].fen, fenAfter, beforeLines })
      continue
    }
    const after = getEval(fenAfter, multipv, depth)
    if (!after?.lines[0]) return null
    plies.push({
      fenBefore: positions[ply - 1].fen, fenAfter, beforeLines, afterEval: scoreOf(after.lines[0]),
    })
  }
  return plies
}
