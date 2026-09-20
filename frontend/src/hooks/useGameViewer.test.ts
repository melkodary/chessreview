import { describe, it, expect } from 'vitest'
import { buildPositions } from './useGameViewer'

const CLOCKED =
  '[TimeControl "180+2"]\n\n1. e4 {[%clk 0:02:58]} e5 {[%clk 0:02:57]} 2. Nf3 {[%clk 0:02:56]} *'
const NO_CLOCKS = '1. e4 e5 2. Nf3 *'

describe('buildPositions secondsSpent', () => {
  it('populates secondsSpent per ply from a clocked PGN; start step is null', () => {
    const steps = buildPositions(CLOCKED)
    expect(steps[0].secondsSpent).toBeNull() // start position
    expect(steps[1].secondsSpent).toBe(4) // e4
    expect(steps[2].secondsSpent).toBe(5) // e5
    expect(steps[3].secondsSpent).toBe(4) // Nf3
  })

  it('leaves secondsSpent null for a clockless game', () => {
    const steps = buildPositions(NO_CLOCKS)
    expect(steps.every((s) => s.secondsSpent === null)).toBe(true)
  })
})
