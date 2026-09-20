import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../engine/sweepGame', () => ({ sweepGame: vi.fn() }))
vi.mock('../api/review', () => ({ winChance: vi.fn() }))

import { useProvisionalCurve, type DeepSweep } from './useProvisionalCurve'
import { sweepGame, type SweepPoint } from '../engine/sweepGame'
import { winChance } from '../api/review'
import { SWEEP_DEPTH, SWEEP_MULTIPV } from '../config'

const mockSweep = vi.mocked(sweepGame)
const mockWinChance = vi.mocked(winChance)

// index 0 is the start position and is never swept; index i is after ply i.
const POSITIONS = [
  { fen: 'start' }, { fen: 'p1' }, { fen: 'p2' }, { fen: 'p3' },
]

// Converts every point to a fixed win, so a test only has to assert the plies.
function flatConversion() {
  mockWinChance.mockImplementation(async (points) =>
    points.map((p) => ({ ply: p.ply, winAfterPlayed: 50 })))
}

describe('useProvisionalCurve', () => {
  beforeEach(() => { mockSweep.mockReset(); mockWinChance.mockReset() })

  it('sweeps every ply but the start position and returns converted points', async () => {
    flatConversion()
    mockSweep.mockImplementation(async (positions, _d, _m, _s, onPoints) => {
      onPoints(positions.map((p) => ({ ply: p.ply, cpWhite: 10 })))
    })

    const { result } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, whiteElo: 1500, blackElo: 1400, enabled: true,
    }))

    await waitFor(() => expect(result.current).toHaveLength(3))
    expect(mockSweep.mock.calls[0][0]).toEqual([
      { fen: 'p1', ply: 1 }, { fen: 'p2', ply: 2 }, { fen: 'p3', ply: 3 },
    ])
    expect(result.current.map((p) => p.ply)).toEqual([1, 2, 3])
    expect(mockWinChance.mock.calls[0].slice(1, 3)).toEqual([1500, 1400])
  })

  it('resumes from the first ply with no point yet after the engine is yielded', async () => {
    flatConversion()
    mockSweep.mockImplementationOnce(async (_p, _d, _m, _s, onPoints) => {
      onPoints([{ ply: 1, cpWhite: 5 }])
    })

    const { result, rerender } = renderHook(
      ({ enabled }) => useProvisionalCurve({ positions: POSITIONS, enabled }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current).toHaveLength(1))

    // Exploration starts, then ends: the second sweep must skip the covered ply.
    mockSweep.mockImplementationOnce(async () => {})
    rerender({ enabled: false })
    rerender({ enabled: true })

    await waitFor(() => expect(mockSweep).toHaveBeenCalledTimes(2))
    expect(mockSweep.mock.calls[1][0]).toEqual([
      { fen: 'p2', ply: 2 }, { fen: 'p3', ply: 3 },
    ])
  })

  it('merges flushes that resolve out of order into ply order', async () => {
    const late: Array<(v: { ply: number; winAfterPlayed: number }[]) => void> = []
    mockWinChance.mockImplementation(() => new Promise((resolve) => { late.push(resolve) }))
    mockSweep.mockImplementation(async (_p, _d, _m, _s, onPoints) => {
      onPoints([{ ply: 1, cpWhite: 5 }])
      onPoints([{ ply: 2, cpWhite: 5 }])
    })

    const { result } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, enabled: true,
    }))
    await waitFor(() => expect(late).toHaveLength(2))

    // Second batch answers first.
    await act(async () => {
      late[1]([{ ply: 2, winAfterPlayed: 40 }])
      late[0]([{ ply: 1, winAfterPlayed: 60 }])
    })
    expect(result.current).toEqual([
      { ply: 1, winAfterPlayed: 60 },
      { ply: 2, winAfterPlayed: 40 },
    ])
  })

  it('drops a batch silently when /win-chance fails, leaving the graph as it was', async () => {
    mockWinChance.mockRejectedValue(new Error('unreachable'))
    mockSweep.mockImplementation(async (_p, _d, _m, _s, onPoints) => {
      onPoints([{ ply: 1, cpWhite: 5 }])
    })

    const { result } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, enabled: true,
    }))
    await waitFor(() => expect(mockWinChance).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it('clears points and re-sweeps from ply 1 when the game changes', async () => {
    flatConversion()
    mockSweep.mockImplementation(async (positions, _d, _m, _s, onPoints) => {
      onPoints(positions.map((p): SweepPoint => ({ ply: p.ply, cpWhite: 1 })))
    })

    const { result, rerender } = renderHook(
      ({ positions }) => useProvisionalCurve({ positions, enabled: true }),
      { initialProps: { positions: POSITIONS } },
    )
    await waitFor(() => expect(result.current).toHaveLength(3))

    rerender({ positions: [{ fen: 'other-start' }, { fen: 'o1' }] })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(mockSweep.mock.calls[1][0]).toEqual([{ fen: 'o1', ply: 1 }])
  })

  it('does not restart the sweep when the caller re-renders', async () => {
    flatConversion()
    mockSweep.mockResolvedValue(undefined)

    const { rerender } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, enabled: true,
    }))
    await waitFor(() => expect(mockSweep).toHaveBeenCalledTimes(1))
    // The review polls every 2s; a re-render must not re-enter the engine.
    rerender()
    rerender()
    expect(mockSweep).toHaveBeenCalledTimes(1)
  })
})

// 1. f3 e5 2. g4 Qh4# — the final position is checkmate.
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'

describe('useProvisionalCurve — pass 2 (frontend-sourced review)', () => {
  beforeEach(() => { mockSweep.mockReset(); mockWinChance.mockReset() })

  function deep(over: Partial<DeepSweep> = {}): DeepSweep {
    return { depth: 18, multipv: 2, enabled: true, onProgress: vi.fn(), onDone: vi.fn(), ...over }
  }

  it('runs after pass 1, at the request depth/MultiPV, over every position from the seed', async () => {
    flatConversion()
    mockSweep.mockImplementation(async (positions, _d, _m, _s, onPoints) => {
      onPoints(positions.map((p) => ({ ply: p.ply, cpWhite: 10 })))
      return true
    })
    const d = deep()
    const { result } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, enabled: true, deep: d,
    }))

    await waitFor(() => expect(d.onDone).toHaveBeenCalledTimes(1))
    expect(d.onDone).toHaveBeenCalledWith(true)
    expect(mockSweep).toHaveBeenCalledTimes(2)
    expect(mockSweep.mock.calls[0].slice(1, 3)).toEqual([SWEEP_DEPTH, SWEEP_MULTIPV])
    expect(mockSweep.mock.calls[1][0]).toEqual([
      { fen: 'start', ply: 0 }, { fen: 'p1', ply: 1 }, { fen: 'p2', ply: 2 }, { fen: 'p3', ply: 3 },
    ])
    expect(mockSweep.mock.calls[1].slice(1, 3)).toEqual([18, 2])
    // Both passes share one signal.
    expect(mockSweep.mock.calls[1][3]).toBe(mockSweep.mock.calls[0][3])
    // Progress counts plies (the seed is not one); the curve sharpened in place.
    expect(d.onProgress).toHaveBeenLastCalledWith(3)
    expect(result.current.map((p) => p.ply)).toEqual([1, 2, 3])
  })

  it('never sweeps a checkmated final position, which no search can reach at depth', async () => {
    mockSweep.mockResolvedValue(true)
    const d = deep()
    renderHook(() => useProvisionalCurve({
      positions: [{ fen: 'start' }, { fen: 'p1' }, { fen: MATED }], enabled: true, deep: d,
    }))
    await waitFor(() => expect(d.onDone).toHaveBeenCalledWith(true))
    expect(mockSweep.mock.calls[0][0]).toEqual([{ fen: 'p1', ply: 1 }])
    expect(mockSweep.mock.calls[1][0]).toEqual([{ fen: 'start', ply: 0 }, { fen: 'p1', ply: 1 }])
  })

  it('yields on the arbitration condition and resumes, submitting once', async () => {
    let release!: (complete: boolean) => void
    mockSweep
      .mockResolvedValueOnce(true) // pass 1
      .mockImplementationOnce((_p, _d, _m, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(false))
        release = resolve
      }))
    const d = deep()
    const { rerender } = renderHook(
      ({ enabled }) => useProvisionalCurve({
        positions: POSITIONS, enabled, deep: { ...d, enabled },
      }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(mockSweep).toHaveBeenCalledTimes(2))
    const signal = mockSweep.mock.calls[1][3]

    // Exploration starts: the sweep's signal is aborted, and an aborted pass 2 never submits.
    rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    await act(async () => { release(false) })
    expect(d.onDone).not.toHaveBeenCalled()

    // Exploration ends: pass 2 walks the game again (the cache makes it free) and submits.
    mockSweep.mockResolvedValue(true)
    rerender({ enabled: true })
    await waitFor(() => expect(d.onDone).toHaveBeenCalledTimes(1))
    expect(d.onDone).toHaveBeenCalledWith(true)
    expect(mockSweep.mock.calls.at(-1)![0]).toHaveLength(4)
  })

  it('reports an engine that gave up as incomplete, so the caller falls back to the backend', async () => {
    mockSweep.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const d = deep()
    renderHook(() => useProvisionalCurve({ positions: POSITIONS, enabled: true, deep: d }))
    await waitFor(() => expect(d.onDone).toHaveBeenCalledWith(false))
  })

  it('runs pass 2 with the curve switched off, feeding it no points', async () => {
    mockSweep.mockImplementation(async (positions, _d, _m, _s, onPoints) => {
      onPoints(positions.map((p) => ({ ply: p.ply, cpWhite: 10 })))
      return true
    })
    const d = deep()
    const { result } = renderHook(() => useProvisionalCurve({
      positions: POSITIONS, enabled: false, deep: d,
    }))
    await waitFor(() => expect(d.onDone).toHaveBeenCalledWith(true))
    expect(mockSweep).toHaveBeenCalledTimes(1)
    expect(mockSweep.mock.calls[0].slice(1, 3)).toEqual([18, 2])
    expect(mockWinChance).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('does nothing without a pass-2 request and the curve off', () => {
    renderHook(() => useProvisionalCurve({ positions: POSITIONS, enabled: false, deep: null }))
    expect(mockSweep).not.toHaveBeenCalled()
  })
})
