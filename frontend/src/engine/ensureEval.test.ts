import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'

const idle = vi.hoisted(() => ({ fire: () => {} }))
vi.mock('./stockfish', () => ({
  engine: {
    analyze: vi.fn(),
    getStatus: () => ({ url: '', state: 'ready' }),
    onIdle: (cb: () => void) => { idle.fire = cb; return () => {} },
  },
}))

import { engine } from './stockfish'
import type { OnLines } from './stockfish'
import { ensureEval, PRIORITY, resetEvalScheduler, type EvalOutcome } from './ensureEval'
import { putEval, clearEvalCache } from './evalCache'
import { ENGINE_DEPTH_TIMEOUT_MS } from '../config'

const mockAnalyze = vi.mocked(engine.analyze)

function line(evaluation: number, pvUci: string[]): AnalysisLine {
  return { moves: [], evaluation, mate: null, pvUci }
}

function fresh() {
  return new AbortController().signal
}

// One engine.analyze call, driven by hand.
interface Call { fen: string; onLines: OnLines; signal: AbortSignal; superseded: () => void }
let calls: Call[] = []
function manualEngine() {
  mockAnalyze.mockImplementation((fen, _limit, _mpv, onLines, signal, onSuperseded) => {
    calls.push({ fen, onLines, signal: signal!, superseded: onSuperseded! })
    return Promise.resolve()
  })
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ensureEval', () => {
  beforeEach(() => { clearEvalCache(); resetEvalScheduler(); mockAnalyze.mockReset(); calls = [] })
  afterEach(() => { vi.useRealTimers() })

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
    const outcomes: EvalOutcome[] = []
    expect(await ensureEval('boom', 18, 3, fresh(), { onOutcome: (o) => outcomes.push(o) })).toBeNull()
    expect(outcomes[0].result).toBe('boot-fail')
  })

  it('gives up a search stuck short of depth (→ backend fallback) and stops it', async () => {
    vi.useFakeTimers()
    manualEngine()
    const r = ensureEval('stuck', 18, 3, fresh())
    await vi.advanceTimersByTimeAsync(0)
    calls[0].onLines([line(0, ['h7h8q'])], 14, false) // stalls at 14, never reaches 18
    await vi.advanceTimersByTimeAsync(ENGINE_DEPTH_TIMEOUT_MS)
    expect(await r).toBeNull()
    expect(calls[0].signal.aborted).toBe(true)
  })

  it('resolves null without searching when the signal is already aborted', async () => {
    const c = new AbortController(); c.abort()
    expect(await ensureEval('x', 18, 3, c.signal)).toBeNull()
    expect(mockAnalyze).not.toHaveBeenCalled()
  })

  // ── The scheduler ──

  it('shares one search between identical asks, and a shallower ask resolves early', async () => {
    manualEngine()
    const a = ensureEval('p', 18, 2, fresh())
    const b = ensureEval('p', 18, 2, fresh())
    const shallow = ensureEval('p', 12, 1, fresh())
    await flush()
    expect(calls).toHaveLength(1)
    calls[0].onLines([line(0.3, ['e2e4']), line(0.1, ['d2d4'])], 12, false)
    expect((await shallow)?.depth).toBe(12)
    calls[0].onLines([line(0.3, ['e2e4']), line(0.1, ['d2d4'])], 18, true)
    expect((await a)?.depth).toBe(18)
    expect((await b)?.depth).toBe(18)
  })

  it('keeps a search running when its caller leaves, so rejoining loses nothing', async () => {
    manualEngine()
    const first = new AbortController()
    void ensureEval('p', 18, 2, first.signal)
    await flush()
    first.abort() // e.g. a branch edit's cleanup
    const again = ensureEval('p', 18, 2, fresh()) // the re-run asks for the same position
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    calls[0].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await again)?.depth).toBe(18)
  })

  it('lets an orphaned search yield to any position someone waits on', async () => {
    manualEngine()
    const gone = new AbortController()
    void ensureEval('old', 18, 2, gone.signal)
    await flush()
    gone.abort()
    const wanted = ensureEval('new', 18, 2, fresh(), { priority: PRIORITY.sweep })
    await flush()
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].fen).toBe('new')
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect(await wanted).not.toBeNull()
  })

  it('preempts only for strictly higher priority, and resumes the preempted job after', async () => {
    manualEngine()
    const sweep = ensureEval('s', 18, 2, fresh(), { priority: PRIORITY.sweep })
    await flush()
    const backfill = ensureEval('b', 18, 2, fresh(), { priority: PRIORITY.gradeBackfill })
    await flush()
    expect(calls.map((c) => c.fen)).toEqual(['s', 'b']) // sweep preempted
    expect(calls[0].signal.aborted).toBe(true)
    const sameLevel = ensureEval('b2', 18, 2, fresh(), { priority: PRIORITY.gradeBackfill })
    await flush()
    expect(calls).toHaveLength(2) // equal priority waits its turn
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    await flush()
    expect(calls[2].fen).toBe('b2')
    calls[2].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    await flush()
    expect(calls[3].fen).toBe('s') // the sweep's waiter was kept
    calls[3].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await backfill)?.depth).toBe(18)
    expect((await sameLevel)?.depth).toBe(18)
    expect((await sweep)?.depth).toBe(18)
  })

  it('waits for engine idle after another consumer takes the engine, then resumes', async () => {
    manualEngine()
    const r = ensureEval('p', 18, 2, fresh())
    await flush()
    calls[0].superseded() // Analysis called engine.analyze
    void ensureEval('q', 18, 2, fresh())
    await flush()
    expect(calls).toHaveLength(1) // nothing dispatches over the outside search
    idle.fire()
    await flush()
    expect(calls[1].fen).toBe('p')
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await r)?.depth).toBe(18)
  })

  it('times out on running time only, never while queued', async () => {
    vi.useFakeTimers()
    manualEngine()
    void ensureEval('a', 18, 2, fresh(), { priority: PRIORITY.gradeNow })
    const queued = ensureEval('b', 18, 2, fresh(), { priority: PRIORITY.gradeBackfill })
    await vi.advanceTimersByTimeAsync(ENGINE_DEPTH_TIMEOUT_MS - 1)
    calls[0].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    await vi.advanceTimersByTimeAsync(ENGINE_DEPTH_TIMEOUT_MS - 1)
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await queued)?.depth).toBe(18)
  })
})
