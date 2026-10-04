import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'

vi.mock('./stockfish', () => ({ engine: { analyze: vi.fn(), getStatus: () => ({ url: '', state: 'ready' }) } }))

import { engine } from './stockfish'
import { sweepGame, type SweepPoint } from './sweepGame'
import { putEval, clearEvalCache } from './evalCache'

const mockAnalyze = vi.mocked(engine.analyze)

function line(evaluation: number, mate: number | null = null): AnalysisLine {
  return { moves: [], evaluation, mate }
}

function fresh() {
  return new AbortController().signal
}

describe('sweepGame', () => {
  beforeEach(() => { clearEvalCache(); mockAnalyze.mockReset() })

  it('sweeps positions in order, one search per ply', async () => {
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0.5)], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const flushes: SweepPoint[][] = []
    const complete = await sweepGame(
      [{ fen: 'a', ply: 1 }, { fen: 'b', ply: 2 }],
      12, 1, fresh(),
      (batch) => flushes.push(batch),
    )
    expect(complete).toBe(true)
    expect(mockAnalyze).toHaveBeenCalledTimes(2)
    expect(flushes.flat()).toEqual([
      { ply: 1, cpWhite: 50 },
      { ply: 2, cpWhite: 50 },
    ])
  })

  it('resumes from evalCache at zero engine cost', async () => {
    putEval('cached', [line(1.0)], 12)
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0.2)], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const flushes: SweepPoint[][] = []
    await sweepGame(
      [{ fen: 'cached', ply: 1 }, { fen: 'fresh', ply: 2 }],
      12, 1, fresh(),
      (batch) => flushes.push(batch),
    )
    expect(mockAnalyze).toHaveBeenCalledTimes(1) // the cached ply is never searched
    expect(flushes.flat()).toEqual([
      { ply: 1, cpWhite: 100 },
      { ply: 2, cpWhite: 20 },
    ])
  })

  it('yields silently mid-sweep on abort/boot failure, flushing what it already has', async () => {
    let call = 0
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      call += 1
      if (call === 2) return Promise.reject(new Error('boot failure'))
      onLines([line(0.3)], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const flushes: SweepPoint[][] = []
    const complete = await sweepGame(
      [{ fen: 'a', ply: 1 }, { fen: 'b', ply: 2 }, { fen: 'c', ply: 3 }],
      12, 1, fresh(),
      (batch) => flushes.push(batch),
    )
    expect(complete).toBe(false) // a review payload must never be built from this
    expect(mockAnalyze).toHaveBeenCalledTimes(2) // never reaches ply 3
    expect(flushes.flat()).toEqual([{ ply: 1, cpWhite: 30 }])
  })

  it('gives up silently with nothing flushed when the first search fails', async () => {
    mockAnalyze.mockRejectedValue(new Error('no SharedArrayBuffer'))
    const flushes: SweepPoint[][] = []
    await sweepGame([{ fen: 'a', ply: 1 }], 12, 1, fresh(), (batch) => flushes.push(batch))
    expect(flushes).toEqual([])
  })

  it('maps mate to a signed point distinct from cpWhite', async () => {
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      onLines([line(0, 3)], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const flushes: SweepPoint[][] = []
    await sweepGame([{ fen: 'a', ply: 1 }], 12, 1, fresh(), (batch) => flushes.push(batch))
    expect(flushes.flat()).toEqual([{ ply: 1, mate: 3 }])
  })

  it('flushes on the timer, not just once at the end', async () => {
    let t = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t)
    mockAnalyze.mockImplementation((_fen, limit, _mpv, onLines) => {
      t += 1100 // past SWEEP_FLUSH_MS's 1000ms default between each position
      onLines([line(0.1)], limit.kind === 'depth' ? limit.depth : 0, true)
      return Promise.resolve()
    })
    const flushes: SweepPoint[][] = []
    await sweepGame(
      [{ fen: 'a', ply: 1 }, { fen: 'b', ply: 2 }],
      12, 1, fresh(),
      (batch) => flushes.push(batch),
    )
    now.mockRestore()
    expect(flushes).toEqual([
      [{ ply: 1, cpWhite: 10 }],
      [{ ply: 2, cpWhite: 10 }],
    ])
  })
})
