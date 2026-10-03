import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { OnLines, SearchLimit } from '../engine/stockfish'
import { useStreamingAnalysis } from './useStreamingAnalysis'
import { clearEvalCache } from '../engine/evalCache'

// Drive the engine singleton from the test: capture the onLines callback so we
// can push frames, and let the test decide whether analyze resolves or rejects.
const calls: { fen: string; limit: SearchLimit; multipv: number; onLines: OnLines; signal?: AbortSignal }[] = []
let analyzeResult: Promise<void> = Promise.resolve()

const configureCalls: { threads?: number; hash?: number }[] = []

vi.mock('../engine/stockfish', () => ({
  engine: {
    analyze: vi.fn((fen: string, limit: SearchLimit, multipv: number, onLines: OnLines, signal?: AbortSignal) => {
      calls.push({ fen, limit, multipv, onLines, signal })
      return analyzeResult
    }),
    configure: vi.fn((next: { threads?: number; hash?: number }) => {
      configureCalls.push(next)
    }),
  },
}))

// The throttle window is read per fire, so a getter lets a test dial it to 0
// (the documented "no throttle" degradation) without a second module graph.
let throttleMs = 250
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>()
  return { ...actual, get ANALYSIS_THROTTLE_MS() { return throttleMs } }
})

const FEN_A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FEN_B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
// After 1. e4 e5 — the position the top line's second move reaches.
const FEN_C = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const FEN_D = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'

const LINE = { moves: ['e4'], evaluation: 0.3, mate: null }
const PV = { moves: ['e4', 'e5', 'Nf3'], evaluation: 0.3, mate: null }
const PV2 = { moves: ['d4', 'd5'], evaluation: 0.1, mate: null }
const THREADS = 4
const HASH = 64

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  configureCalls.length = 0
  analyzeResult = Promise.resolve()
  throttleMs = 250
  clearEvalCache()
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useStreamingAnalysis (engine-driven)', () => {
  it('stays idle and does not schedule analysis while disabled', () => {
    const { result } = renderHook(() =>
      useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH, false))
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current).toEqual({
      lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: false, error: '',
    })
    expect(calls).toHaveLength(0)
  })

  it('starts after becoming enabled and aborts when disabled again', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH, enabled),
      { initialProps: { enabled: false } },
    )
    rerender({ enabled: true })
    expect(result.current.loading).toBe(true)
    expect(calls).toHaveLength(1)

    rerender({ enabled: false })
    expect(calls[0].signal?.aborted).toBe(true)
    expect(result.current).toEqual({
      lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: false, error: '',
    })
  })

  it('calls engine.analyze with a movetime limit built from the time setting', () => {
    renderHook(() => useStreamingAnalysis(FEN_A, 10_000, 2, THREADS, HASH))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      fen: FEN_A, limit: { kind: 'movetime', ms: 10_000 }, multipv: 2,
    })
  })

  it('re-fires analyze when the time setting changes', () => {
    const { rerender } = renderHook(
      ({ timeMs }) => useStreamingAnalysis(FEN_A, timeMs, 3, THREADS, HASH),
      { initialProps: { timeMs: 10_000 } },
    )
    expect(calls).toHaveLength(1)

    rerender({ timeMs: 60_000 })
    act(() => { vi.advanceTimersByTime(250) })
    expect(calls).toHaveLength(2)
    expect(calls[1].limit).toEqual({ kind: 'movetime', ms: 60_000 })
  })

  it('maps streamed frames into state (loading until final)', () => {
    const { result } = renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 1, THREADS, HASH))
    act(() => { calls[0].onLines([LINE], 7, false) })
    expect(result.current).toMatchObject({
      lines: [LINE], displayLines: [LINE], freshCount: 1, currentDepth: 7, loading: true,
    })
    act(() => { calls[0].onLines([LINE], 18, true) })
    expect(result.current).toMatchObject({ currentDepth: 18, loading: false, error: '' })
  })

  it('clears the live channel when the fen changes (no stale live lines)', () => {
    const { result, rerender } = renderHook(({ fen }) => useStreamingAnalysis(fen, 20_000, 1, THREADS, HASH), {
      initialProps: { fen: FEN_A },
    })
    act(() => { calls[0].onLines([LINE], 12, true) })
    expect(result.current.lines).toEqual([LINE])
    rerender({ fen: FEN_B })
    expect(result.current).toMatchObject({ lines: [], currentDepth: 0, loading: true, error: '' })
  })

  it('surfaces a boot/engine failure as error state', async () => {
    analyzeResult = Promise.reject(new Error('unsupported browser'))
    const { result } = renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 1, THREADS, HASH))
    await act(async () => { await Promise.resolve() })
    expect(result.current).toMatchObject({ loading: false, error: 'unsupported browser', lines: [] })
  })

  it('calls engine.configure with threads/hash on mount', () => {
    renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH))
    expect(configureCalls).toEqual([{ threads: THREADS, hash: HASH }])
  })

  it('re-calls engine.configure and re-fires analyze when engineThreads/engineHash change', () => {
    const { rerender } = renderHook(
      ({ threads, hash }) => useStreamingAnalysis(FEN_A, 20_000, 3, threads, hash),
      { initialProps: { threads: THREADS, hash: HASH } },
    )
    expect(calls).toHaveLength(1)

    rerender({ threads: 6, hash: 128 })
    expect(configureCalls).toEqual([{ threads: THREADS, hash: HASH }, { threads: 6, hash: 128 }])

    act(() => { vi.advanceTimersByTime(250) })
    expect(calls).toHaveLength(2)
  })

  it('does not call engine.configure again when only fen changes', () => {
    const { rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    expect(configureCalls).toHaveLength(1)

    rerender({ fen: FEN_B })
    expect(configureCalls).toHaveLength(1)
  })
})

describe('useStreamingAnalysis leading-edge throttle', () => {
  it('fires the first change with no delay', () => {
    renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH))
    expect(calls).toHaveLength(1)
    expect(calls[0].fen).toBe(FEN_A)
  })

  it('coalesces a burst to one search per window, using the final position', () => {
    const { rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    expect(calls).toHaveLength(1)

    // ~30ms key repeat through three intermediate positions.
    for (const fen of [FEN_B, FEN_C, FEN_D]) {
      act(() => { vi.advanceTimersByTime(30) })
      rerender({ fen })
      expect(calls).toHaveLength(1)
    }

    act(() => { vi.advanceTimersByTime(250) })
    expect(calls).toHaveLength(2)
    expect(calls[1].fen).toBe(FEN_D)
  })

  it('cancels the trailing fire on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    act(() => { vi.advanceTimersByTime(30) })
    rerender({ fen: FEN_B })
    unmount()
    act(() => { vi.advanceTimersByTime(500) })
    expect(calls).toHaveLength(1)
  })

  it('fires every change immediately when the throttle is 0', () => {
    throttleMs = 0
    const { rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    rerender({ fen: FEN_B })
    rerender({ fen: FEN_C })
    expect(calls.map((c) => c.fen)).toEqual([FEN_A, FEN_B, FEN_C])
  })
})

describe('useStreamingAnalysis display channel', () => {
  it('seeds a predicted line from the played line\'s tail (freshCount 1)', () => {
    const { result, rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    act(() => { calls[0].onLines([PV, PV2], 14, false) })

    rerender({ fen: FEN_B })
    expect(result.current.freshCount).toBe(1)
    expect(result.current.displayLines.map((l) => l.moves)).toEqual([
      ['e5', 'Nf3'], ['d4', 'd5'],
    ])
    // No depth is synthesised for a carried line — the badge stays hidden.
    expect(result.current.currentDepth).toBe(0)
    expect(result.current.lines).toEqual([])
  })

  it('holds the last lines dimmed on a miss (freshCount 0)', () => {
    const { result, rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_B } },
    )
    act(() => { calls[0].onLines([PV2], 14, false) })

    // Back navigation: no held line's first move reaches FEN_A.
    rerender({ fen: FEN_A })
    expect(result.current.freshCount).toBe(0)
    expect(result.current.displayLines).toEqual([PV2])
  })

  it('keeps all rows fresh when only a setting changed (same fen)', () => {
    const { result, rerender } = renderHook(
      ({ timeMs }) => useStreamingAnalysis(FEN_A, timeMs, 3, THREADS, HASH),
      { initialProps: { timeMs: 10_000 } },
    )
    act(() => { calls[0].onLines([PV, PV2], 14, false) })

    rerender({ timeMs: 60_000 })
    expect(result.current.displayLines).toEqual([PV, PV2])
    expect(result.current.freshCount).toBe(2)
  })

  it('clears the held value when disabled', () => {
    const { result, rerender } = renderHook(
      ({ fen, enabled }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH, enabled),
      { initialProps: { fen: FEN_A, enabled: true } },
    )
    act(() => { calls[0].onLines([PV, PV2], 14, false) })

    rerender({ fen: FEN_A, enabled: false })
    expect(result.current.displayLines).toEqual([])

    // Re-enabling elsewhere must not resurrect the cleared lines (the same FEN
    // may show its own cached search — that is this position's eval).
    rerender({ fen: FEN_D, enabled: true })
    expect(result.current.displayLines).toEqual([])
    expect(result.current.freshCount).toBe(0)
  })

  it('clears the display channel on an error', async () => {
    const { result, rerender } = renderHook(
      ({ fen }) => useStreamingAnalysis(fen, 20_000, 3, THREADS, HASH),
      { initialProps: { fen: FEN_A } },
    )
    act(() => { calls[0].onLines([PV, PV2], 14, false) })
    expect(result.current.displayLines).toHaveLength(2)

    analyzeResult = Promise.reject(new Error('unsupported browser'))
    rerender({ fen: FEN_B })
    await act(async () => {
      vi.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(result.current).toMatchObject({
      displayLines: [], freshCount: 0, error: 'unsupported browser',
    })
  })

  it('resumes at the cached depth on remount and hides shallower re-search frames', async () => {
    const first = renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH))
    await act(async () => { calls[0].onLines([PV, PV2], 18, false) })
    first.unmount() // tab switch

    const { result } = renderHook(() => useStreamingAnalysis(FEN_A, 20_000, 3, THREADS, HASH))
    expect(result.current.currentDepth).toBe(18)
    expect(result.current.displayLines).toEqual([PV, PV2])

    await act(async () => { calls[1].onLines([LINE], 5, false) })
    expect(result.current.currentDepth).toBe(18)
    await act(async () => { calls[1].onLines([PV, PV2], 19, false) })
    expect(result.current.currentDepth).toBe(19)
  })
})
