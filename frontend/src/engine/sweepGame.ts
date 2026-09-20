import { SWEEP_FLUSH_MS } from '../config'
import { ensureEval } from './ensureEval'
import type { CachedPosition } from './evalCache'

export interface SweepPosition {
  fen: string
  ply: number
}

// Exactly one of cp/mate, white-POV — the `_CpOrMate` convention POST
// /win-chance expects (review._info_to_line); the backend folds mate to
// +-10000 (review/winchance.py:_cp_white), not this driver.
export interface SweepPoint {
  ply: number
  cpWhite?: number
  mate?: number
}

function pointFrom(ply: number, pos: CachedPosition): SweepPoint {
  const line = pos.lines[0]
  return line.mate != null
    ? { ply, mate: line.mate }
    : { ply, cpWhite: Math.round(line.evaluation * 100) }
}

// Sequential sweep over `positions` via the shared eval-bar driver
// (engine/ensureEval.ts): cache-check -> WASM search -> cache -> resolve, so a
// resumed sweep re-walks already-covered plies at zero engine cost. Batches
// points and hands them to `onPoints` on a wall-clock timer (SWEEP_FLUSH_MS)
// plus once more on exit, so the curve fills in over the sweep rather than
// arriving as one late payload. Yields silently -- no error, no partial
// point -- the moment `ensureEval` resolves null (abort or engine boot
// failure), flushing whatever was already collected first. Resolves true only
// when every position was evaluated.
export async function sweepGame(
  positions: SweepPosition[],
  depth: number,
  multipv: number,
  signal: AbortSignal,
  onPoints: (points: SweepPoint[]) => void,
): Promise<boolean> {
  let batch: SweepPoint[] = []
  let lastFlush = Date.now()
  const flush = () => {
    if (batch.length === 0) return
    onPoints(batch)
    batch = []
    lastFlush = Date.now()
  }

  for (const { fen, ply } of positions) {
    const hit = await ensureEval(fen, depth, multipv, signal)
    if (!hit) {
      flush()
      return false
    }
    batch.push(pointFrom(ply, hit))
    if (Date.now() - lastFlush >= SWEEP_FLUSH_MS) flush()
  }
  flush()
  return true
}
