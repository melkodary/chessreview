import { useEffect } from 'react'
import { Chess } from 'chess.js'
import { ensureEval, PRIORITY } from '../engine/ensureEval'
import { SPECULATE_DELAY_MS, SPECULATE_MOVES } from '../config'

interface Params {
  fen: string // where the board is parked: a game position, or the branch tip
  depth: number
  multipv: number
  enabled: boolean
}

// Searches what the next deviation would need before it is played: `fen` (its
// before-position) and the after-positions of `fen`'s top engine moves, at the
// lowest grade priority. Leaving `fen` orphans the searches; they finish into the cache.
export function useSpeculation({ fen, depth, multipv, enabled }: Params): void {
  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    const opts = { priority: PRIORITY.speculate }
    const timer = setTimeout(async () => {
      const here = await ensureEval(fen, depth, multipv, ctrl.signal, opts)
      if (!here) return
      const afters = here.lines.slice(0, SPECULATE_MOVES).flatMap((l) => {
        const uci = l.pvUci?.[0]
        if (!uci) return []
        const board = new Chess(fen)
        board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
        return [board.fen()]
      })
      await Promise.all(afters.map((f) => ensureEval(f, depth, multipv, ctrl.signal, opts)))
    }, SPECULATE_DELAY_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [fen, depth, multipv, enabled])
}
