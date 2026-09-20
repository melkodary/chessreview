import { useEffect, useReducer } from 'react'
import { engine } from '../engine/stockfish'

/** Re-renders on engine run-state changes (idle/booting/ready/error); returns the current status. */
export function useEngineStatus() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => engine.onStatusChange(force), [])
  return engine.getStatus()
}
