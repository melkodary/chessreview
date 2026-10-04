import { engine } from './stockfish'
import { getEval, putEval, type CachedPosition } from './evalCache'
import { ENGINE_DEPTH_TIMEOUT_MS } from '../config'

// How one ensureEval call was answered, for the grade trace (engine/gradeTrace.ts).
// `firstFrameMs` covers boot plus waiting out the previous search's stop.
export interface EvalOutcome {
  source: 'cache' | 'search'
  result: 'ok' | 'timeout' | 'aborted' | 'boot-fail'
  ms: number
  depth: number
  engineState: ReturnType<typeof engine.getStatus>['state']
  firstFrameMs?: number
}

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
// Resolves null on abort (latest-wins supersede), an engine boot failure
// (no SharedArrayBuffer / worker error) or a search stuck short of `depth` past
// ENGINE_DEPTH_TIMEOUT_MS — the caller then omits the eval payload so the
// backend searches instead (guaranteed parity; a `stop` would hand back a
// shallower eval and break it).
export function ensureEval(
  fen: string,
  depth: number,
  multipv: number,
  signal: AbortSignal,
  onOutcome?: (o: EvalOutcome) => void,
): Promise<CachedPosition | null> {
  const t0 = performance.now()
  const engineState = engine.getStatus().state
  const hit = getEval(fen, multipv, depth)
  if (hit) {
    onOutcome?.({ source: 'cache', result: 'ok', ms: 0, depth: hit.depth, engineState })
    return Promise.resolve(hit)
  }
  if (signal.aborted) return Promise.resolve(null)

  return new Promise((resolve) => {
    // Our own signal, so a timeout stops this search and not whichever is current.
    const search = new AbortController()
    let result: EvalOutcome['result'] = 'aborted'
    const timer = setTimeout(() => { result = 'timeout'; search.abort() }, ENGINE_DEPTH_TIMEOUT_MS)
    let settled = false
    let reached = 0
    let firstFrameMs: number | undefined
    const done = (v: CachedPosition | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onOutcome?.({
        source: 'search', result: v ? 'ok' : result, ms: performance.now() - t0,
        depth: reached, engineState, firstFrameMs,
      })
      resolve(v)
    }
    signal.addEventListener('abort', () => search.abort())
    search.signal.addEventListener('abort', () => done(null))
    engine
      .analyze(fen, { kind: 'depth', depth }, multipv, (lines, d) => {
        firstFrameMs ??= performance.now() - t0
        reached = Math.max(reached, d)
        putEval(fen, lines, d, multipv)
        if (d >= depth) done({ lines, depth: d, multipv })
      }, search.signal)
      .catch(() => { result = 'boot-fail'; done(null) }) // boot failure → BE fallback
  })
}
