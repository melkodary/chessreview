import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'

vi.mock('./stockfish', () => ({ engine: { analyze: vi.fn() } }))

import { engine } from './stockfish'
import { ensureEval } from './ensureEval'
import { putEval, clearEvalCache } from './evalCache'
import { ENGINE_DEPTH_TIMEOUT_MS } from '../config'

const mockAnalyze = vi.mocked(engine.analyze)

function line(evaluation: number, pvUci: string[]): AnalysisLine {
  return { moves: [], evaluation, mate: null, pvUci }
}

function fresh() {
  return new AbortController().signal
}

describe('ensureEval', () => {
  beforeEach(() => { clearEvalCache(); mockAnalyze.mockReset() })

  it('returns a cached entry deep enough without searching', async () => {
    putEval('f', [line(0.2, ['e2e4']), line(0.1, ['d2d4']), line(0, ['g1f3'])], 18)
    const r = await ensureEval('f', 18, 3, fresh())
    expect(r?.depth).toBe(18)
    expect(mockAnalyze).not.toHaveBeenCalled()
  })

  it('drives one search on a cache miss and resolves at target depth', async () => {
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0.1, ['d2d4'])], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const r = await ensureEval('miss', 18, 3, fresh())
    expect(mockAnalyze).toHaveBeenCalledOnce()
    // A depth limit, not the time budget Analysis uses: the branch grader's
    // parity with the backend classifier is stated in depth.
    expect(mockAnalyze.mock.calls[0][1]).toEqual({ kind: 'depth', depth: 18 })
    expect(r).toEqual({ lines: [line(0.1, ['d2d4'])], depth: 18, multipv: 3 })
  })

  it('re-searches when the cached entry is shallower than the target', async () => {
    putEval('shallow', [line(0, ['e2e4'])], 10)
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0.4, ['g1f3'])], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const r = await ensureEval('shallow', 18, 3, fresh())
    expect(mockAnalyze).toHaveBeenCalledOnce()
    expect(r?.depth).toBe(18)
  })

  it('re-searches when the cached entry has fewer lines than multipv', async () => {
    putEval('thin', [line(0, ['e2e4'])], 25) // deep, but rank-1 only
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0.4, ['g1f3']), line(0.2, ['e2e4'])], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const r = await ensureEval('thin', 18, 2, fresh())
    expect(mockAnalyze).toHaveBeenCalledOnce()
    expect(r?.lines).toHaveLength(2)
  })

  it('accepts a cached entry searched wide enough, though it returned fewer lines', async () => {
    putEval('forced', [line(0, ['e2e4'])], 18, 2) // one legal move, searched at MultiPV 2
    const r = await ensureEval('forced', 18, 2, fresh())
    expect(mockAnalyze).not.toHaveBeenCalled()
    expect(r?.lines).toHaveLength(1)
  })

  it('resolves null on an engine boot failure (→ backend fallback)', async () => {
    mockAnalyze.mockRejectedValue(new Error('no SharedArrayBuffer'))
    expect(await ensureEval('boom', 18, 3, fresh())).toBeNull()
  })

  it('gives up a search stuck short of depth (→ backend fallback) and stops it', async () => {
    vi.useFakeTimers()
    let searchSignal: AbortSignal | undefined
    mockAnalyze.mockImplementation((_fen, _limit, _mpv, onLines, s) => {
      searchSignal = s
      onLines([line(0, ['h7h8q'])], 14, false) // stalls at 14, never reaches 18
      return Promise.resolve()
    })
    const r = ensureEval('stuck', 18, 3, fresh())
    await vi.advanceTimersByTimeAsync(ENGINE_DEPTH_TIMEOUT_MS)
    expect(await r).toBeNull()
    expect(searchSignal?.aborted).toBe(true)
    vi.useRealTimers()
  })

  it('resolves null without searching when the signal is already aborted', async () => {
    const c = new AbortController(); c.abort()
    expect(await ensureEval('x', 18, 3, c.signal)).toBeNull()
    expect(mockAnalyze).not.toHaveBeenCalled()
  })
})
