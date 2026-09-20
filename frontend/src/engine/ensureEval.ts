import { engine } from './stockfish'
import { getEval, putEval, type CachedPosition } from './evalCache'

// Return an eval for `fen` at depth >= `depth` with >= `multipv` lines: a cached
// one when the eval bar (or an earlier grade) already searched it that deep and
// that wide, else drive one WASM search and cache it. This is the branch
// grader's data source — it reuses the browser's own eval-bar work and only
// searches on a miss (one serialized WASM worker; §5.2 of the phase-2 spec).
//
// The limit here stays a depth even though Analysis now searches on a time
// budget: the depth demanded is the backend classifier's depth, and that equality
// is what lets a branch ply be graded in the browser and still match what the
// backend would have produced. A time budget cannot promise it.
//
// Resolves null on abort (latest-wins supersede) or an engine boot failure
// (no SharedArrayBuffer / worker error) — the caller then omits the eval payload
// so the backend searches instead (guaranteed parity).
export function ensureEval(
  fen: string,
  depth: number,
  multipv: number,
  signal: AbortSignal,
): Promise<CachedPosition | null> {
  const hit = getEval(fen, multipv, depth)
  if (hit) return Promise.resolve(hit)
  if (signal.aborted) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const done = (v: CachedPosition | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    signal.addEventListener('abort', () => done(null))
    engine
      .analyze(fen, { kind: 'depth', depth }, multipv, (lines, d) => {
        putEval(fen, lines, d, multipv)
        if (d >= depth) done({ lines, depth: d, multipv })
      }, signal)
      .catch(() => done(null)) // boot failure → BE fallback
  })
}
