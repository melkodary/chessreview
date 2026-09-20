import { useEffect, useRef, useState } from 'react'
import { winChance, type ProvisionalPoint } from '../api/review'
import { sweepGame, type SweepPoint } from '../engine/sweepGame'
import { isTerminalFen } from '../engine/reviewPayload'
import { SWEEP_DEPTH, SWEEP_MULTIPV } from '../config'

// Pass 2 of a frontend-sourced review: a whole-game sweep at the review's own
// depth/MultiPV, run after pass 1 on the same signal. `onDone(true)` means every
// position is evaluated (and cached) — the payload can be built; false means the
// engine gave up (boot failure), never an abort.
export interface DeepSweep {
  depth: number
  multipv: number
  // The same arbitration as pass 1 — the sweep yields, and resumes, with it.
  enabled: boolean
  onProgress: (plies: number) => void
  onDone: (complete: boolean) => void
}

interface Params {
  // Game-line steps as useGameViewer builds them: index i is the position
  // *after* ply i, so index 0 (the start position) is never swept.
  positions: { fen: string }[]
  whiteElo?: number
  blackElo?: number
  // Flag on, review running, Review tab, not exploring. False both stops the
  // sweep and keeps it from ever booting the engine.
  enabled: boolean
  deep?: DeepSweep | null
}

// Points and the game they belong to, stored together so a game change
// invalidates them by comparison rather than by a reset that would have to
// setState from an effect (which this repo's react-hooks rules forbid).
interface Store {
  key: string
  points: ProvisionalPoint[]
}

const EMPTY_POINTS: ProvisionalPoint[] = []

// Flushes can resolve out of order (each is its own POST), so points are kept
// keyed by ply and re-sorted rather than appended.
function merge(prev: ProvisionalPoint[], next: ProvisionalPoint[]): ProvisionalPoint[] {
  const byPly = new Map(prev.map((p) => [p.ply, p]))
  next.forEach((p) => byPly.set(p.ply, p))
  return [...byPly.values()].sort((a, b) => a.ply - b.ply)
}

// A checkmated/stalemated final position never reaches the requested depth
// (Stockfish answers `depth 0`), so ensureEval would wait on it forever.
function sweepable(positions: { fen: string }[]): { fen: string; ply: number }[] {
  const last = positions.length - 1
  return positions
    .map((step, ply) => ({ fen: step.fen, ply }))
    .filter((p) => p.ply !== last || !isTerminalFen(p.fen))
}

/**
 * Browser-estimated eval curve for a review that is still running: sweeps the
 * game with the shipped WASM engine, converts through POST /win-chance, and
 * hands `EvalGraph` points to fill the plies the backend hasn't reached.
 *
 * Lives in ReviewProvider, above the tab Outlet, for the reason useBranchReview
 * does: state that survives the tab-flip unmount is state the engine doesn't
 * re-earn. Three identity hazards shape the effect below, all of them failures
 * that would still render a plausible curve:
 *
 * - The review polls every 2s, so `moves` must never reach this hook — it is
 *   deliberately not a parameter. Only `enabled` (twice a review) and the game
 *   identity can restart the sweep.
 * - `onPoints` is rebuilt per effect run and commits through a functional
 *   setState, so a flush that lands late cannot write a stale array.
 * - A restart resumes from the first ply with no point yet, so yielding the
 *   engine (exploration, a tab flip) costs nothing already paid for.
 *
 * With `deep` set, the same effect runs pass 2 after pass 1 — one signal, one
 * arbitration, sequential by construction: two concurrent `ensureEval`s would
 * preempt each other and the loser would never resolve (decisions 2026-08-23).
 * Pass 2 walks every position; the eval cache makes a resumed walk free.
 */
export function useProvisionalCurve({
  positions, whiteElo, blackElo, enabled, deep,
}: Params): ProvisionalPoint[] {
  const gameKey = positions[positions.length - 1]?.fen ?? ''
  const [store, setStore] = useState<Store>({ key: gameKey, points: EMPTY_POINTS })
  // Touched only inside the effect and its async callbacks, never during
  // render, to stay clear of this repo's react-hooks/refs rule.
  const covered = useRef<{ key: string; plies: Set<number> }>({ key: gameKey, plies: new Set() })
  // Callbacks are read through a ref so a caller re-render never restarts the sweep.
  const deepRef = useRef(deep)
  useEffect(() => { deepRef.current = deep })

  const deepOn = !!deep?.enabled
  const deepDepth = deep?.depth
  const deepMultipv = deep?.multipv

  useEffect(() => {
    if (covered.current.key !== gameKey) covered.current = { key: gameKey, plies: new Set() }
    if (!enabled && !deepOn) return
    const ctrl = new AbortController()
    let stopped = false

    const flush = (batch: SweepPoint[]) => {
      if (stopped) return
      // Fire-and-forget: the sweep must not stall on the network, and every
      // failure path drops the batch silently. A missing estimate is a
      // non-event; a wrong curve is not.
      void winChance(batch, whiteElo, blackElo, ctrl.signal)
        .then((converted) => {
          if (stopped) return
          converted.forEach((p) => covered.current.plies.add(p.ply))
          setStore((prev) => ({
            key: gameKey,
            points: merge(prev.key === gameKey ? prev.points : EMPTY_POINTS, converted),
          }))
        })
        .catch(() => {})
    }

    void (async () => {
      const all = sweepable(positions)
      if (enabled) {
        const todo = all.filter((p) => p.ply >= 1 && !covered.current.plies.has(p.ply))
        if (todo.length > 0) await sweepGame(todo, SWEEP_DEPTH, SWEEP_MULTIPV, ctrl.signal, flush)
      }
      if (!deepOn || deepDepth == null || deepMultipv == null || ctrl.signal.aborted) return
      // Pass 2 sharpens the same curve in place; ply 0 is the seed, not a point.
      let swept = 0
      const deepFlush = (batch: SweepPoint[]) => {
        const plies = batch.filter((p) => p.ply >= 1)
        swept += plies.length
        deepRef.current?.onProgress(swept)
        if (enabled && plies.length > 0) flush(plies)
      }
      const complete = await sweepGame(all, deepDepth, deepMultipv, ctrl.signal, deepFlush)
      if (!ctrl.signal.aborted) deepRef.current?.onDone(complete)
    })()

    return () => {
      stopped = true
      ctrl.abort()
    }
  }, [enabled, deepOn, deepDepth, deepMultipv, gameKey, positions, whiteElo, blackElo])

  // A store left over from the previous game is ignored rather than cleared —
  // clearing would mean setState in an effect for no visible gain.
  return store.key === gameKey ? store.points : EMPTY_POINTS
}
