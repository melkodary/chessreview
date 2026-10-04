import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AnalysisLine } from '../api/analyzer'

vi.mock('../engine/ensureEval', async (orig) => ({
  ...(await orig<typeof import('../engine/ensureEval')>()), ensureEval: vi.fn(),
}))

import { ensureEval, PRIORITY } from '../engine/ensureEval'
import { useSpeculation } from './useSpeculation'
import { SPECULATE_DELAY_MS } from '../config'

const mockEnsure = vi.mocked(ensureEval)
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
const line = (uci: string): AnalysisLine => ({ moves: [], evaluation: 0.3, mate: null, pvUci: [uci] })
const base = { fen: START, depth: 18, multipv: 2, enabled: true }

describe('useSpeculation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockEnsure.mockReset()
    mockEnsure.mockImplementation((fen) => Promise.resolve(fen === START
      ? { lines: [line('e2e4'), line('d2d4'), line('g1f3')], depth: 18, multipv: 3 }
      : { lines: [line('e7e5')], depth: 18, multipv: 2 }))
  })
  afterEach(() => { vi.useRealTimers() })

  it("searches the parked position, then its top moves' after-positions, at speculate priority", async () => {
    renderHook(() => useSpeculation(base))
    await vi.advanceTimersByTimeAsync(SPECULATE_DELAY_MS - 1)
    expect(mockEnsure).not.toHaveBeenCalled() // still stepping through: nothing yet
    await vi.advanceTimersByTimeAsync(1)
    expect(mockEnsure.mock.calls.map((c) => [c[0], c[4]?.priority])).toEqual([
      [START, PRIORITY.speculate], [AFTER_E4, PRIORITY.speculate], [AFTER_D4, PRIORITY.speculate],
    ])
  })

  it('asks nothing when moved on before the delay, or when disabled', async () => {
    const { rerender } = renderHook((p) => useSpeculation(p), { initialProps: base })
    rerender({ ...base, fen: AFTER_E4, enabled: false })
    await vi.advanceTimersByTimeAsync(SPECULATE_DELAY_MS * 2)
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('releases its asks when the board leaves the position', async () => {
    const { rerender } = renderHook((p) => useSpeculation(p), { initialProps: base })
    await vi.advanceTimersByTimeAsync(SPECULATE_DELAY_MS)
    const signal = mockEnsure.mock.calls[0][3]
    rerender({ ...base, fen: AFTER_E4 })
    expect(signal.aborted).toBe(true)
  })
})
