import { useMemo, useCallback } from 'react'
import { Chess } from 'chess.js'
import { moveTimesSpent } from '../moveTimes'

export interface PositionStep {
  fen: string
  san: string | null
  secondsSpent: number | null // time spent reaching this ply; null for start / no clocks
}

export function buildPositions(pgn: string): PositionStep[] {
  const game = new Chess()
  game.loadPgn(pgn)
  const verbose = game.history({ verbose: true })
  const times = moveTimesSpent(pgn) // aligned to plies 1..N; [] when clockless
  const replay = new Chess()
  const out: PositionStep[] = [{ fen: replay.fen(), san: null, secondsSpent: null }]
  verbose.forEach((move, i) => {
    replay.move(move)
    out.push({ fen: replay.fen(), san: move.san, secondsSpent: times[i] ?? null })
  })
  return out
}

export function useGameViewer(
  pgn: string,
  requestedMove: number,
  onMoveChange: (move: number) => void,
) {
  const positions = useMemo(() => buildPositions(pgn), [pgn])
  const moveIndex = Math.max(0, Math.min(requestedMove, positions.length - 1))
  const goTo = useCallback(
    (index: number) => onMoveChange(Math.max(0, Math.min(index, positions.length - 1))),
    [onMoveChange, positions.length],
  )
  // Keyboard nav is wired in GameShell, which routes ←/→ to the game line or the
  // exploration branch depending on whether a variation is being explored.
  return { positions, moveIndex, goTo }
}
