import type { AnalysisLine } from '../api/analyzer'

// A shared, bounded position-eval store: fen -> searches. Written by the
// eval-bar search (useStreamingAnalysis) and by the branch grader's own driven
// searches; read by useBranchReview to grade a ply from the browser's own WASM
// evals instead of a backend Stockfish search (the hybrid, phase-2 spec §5).
//
// A search is good on two axes a reader asks about — depth and width — and one
// slot per fen cannot hold both: keeping only the deepest hides the rank-2 line
// the grader needs, keeping only the widest throws away depth the eval bar
// reached. So a fen holds the frontier: every search no other one beats on both
// axes. Ephemeral + bounded (insertion-order eviction) — a reuse cache, not a
// source of truth; a miss just falls back to a fresh search or BE.

export interface CachedPosition {
  lines: AnalysisLine[]
  depth: number
  // Width searched for, which exceeds lines.length in a position with fewer
  // legal moves — that search still answers a wider reader's ask.
  multipv: number
}

const MAX_ENTRIES = 256
const MAX_PER_FEN = 4
const store = new Map<string, CachedPosition[]>()

const widthOf = (e: CachedPosition) => Math.max(e.multipv, e.lines.length)
const beats = (a: CachedPosition, b: CachedPosition) =>
  a.depth >= b.depth && widthOf(a) >= widthOf(b)

export function putEval(
  fen: string, lines: AnalysisLine[], depth: number, multipv = lines.length,
): void {
  const entry = { lines, depth, multipv }
  const prev = store.get(fen) ?? []
  // Re-insert to move to newest (Map preserves insertion order for eviction) —
  // a beaten write is still a use, so it freshens rather than being dropped.
  store.delete(fen)
  const frontier = prev.some((e) => beats(e, entry))
    ? prev
    : [...prev.filter((e) => !beats(entry, e)), entry]
  if (frontier.length > MAX_PER_FEN) {
    let worst = 0
    for (let i = 1; i < frontier.length; i++) {
      if (frontier[i].depth < frontier[worst].depth) worst = i
    }
    frontier.splice(worst, 1)
  }
  store.set(fen, frontier)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
}

// `minLines` is the caller's MultiPV, `minDepth` its depth floor: a search
// short on either axis is a miss, not a hit. Deepest qualifying search wins.
export function getEval(
  fen: string, minLines = 1, minDepth = 0,
): CachedPosition | undefined {
  let best: CachedPosition | undefined
  for (const e of store.get(fen) ?? []) {
    if (e.depth < minDepth || widthOf(e) < minLines) continue
    if (!best || e.depth > best.depth) best = e
  }
  return best
}

export function clearEvalCache(): void {
  store.clear()
}
