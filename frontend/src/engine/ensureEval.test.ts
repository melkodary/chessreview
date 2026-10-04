import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'

const h = vi.hoisted(() => ({ analyze: vi.fn(), created: [] as unknown[] }))
vi.mock('./stockfish', () => ({
  Engine: class {
    constructor(public opts: unknown) { h.created.push(this) }
    analyze = h.analyze
    getStatus = () => ({ url: '', state: 'ready' })
  },
}))

import type { Engine, OnLines } from './stockfish'
import { ensureEval, PRIORITY, resetEvalScheduler, type EvalOutcome } from './ensureEval'
import { putEval, clearEvalCache } from './evalCache'
import { ENGINE_DEPTH_TIMEOUT_MS } from '../config'

const mockAnalyze = vi.mocked(h.analyze as Engine['analyze'])

function line(evaluation: number, pvUci: string[]): AnalysisLine {
  return { moves: [], evaluation, mate: null, pvUci }
}

function fresh() {
  return new AbortController().signal
}

// One engine.analyze call, driven by hand.
interface Call { fen: string; onLines: OnLines; signal: AbortSignal; superseded: () => void; worker: unknown }
let calls: Call[] = []
function manualEngine() {
  mockAnalyze.mockImplementation(function (this: unknown, fen, _limit, _mpv, onLines, signal, onSuperseded) {
    calls.push({ fen, onLines, signal: signal!, superseded: onSuperseded!, worker: this })
    return Promise.resolve()
  })
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ensureEval', () => {
  beforeEach(() => { clearEvalCache(); resetEvalScheduler(1); mockAnalyze.mockReset(); calls = []; h.created = [] })
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

  it('requeues a search its worker dropped, keeping its waiters', async () => {
    manualEngine()
    const r = ensureEval('p', 18, 2, fresh())
    await flush()
    calls[0].superseded() // a respawn whose reboot failed
    await flush()
    expect(calls[1].fen).toBe('p')
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await r)?.depth).toBe(18)
  })

  it('runs searches side by side, one per worker, each worker single-threaded', async () => {
    resetEvalScheduler(3)
    manualEngine()
    const asks = ['a', 'b', 'c', 'd'].map((f) => ensureEval(f, 18, 2, fresh(), { priority: PRIORITY.gradeNow }))
    await flush()
    expect(calls.map((c) => c.fen)).toEqual(['a', 'b', 'c']) // 'd' waits for a free worker
    expect(new Set(calls.map((c) => c.worker)).size).toBe(3)
    expect(h.created).toHaveLength(3)
    expect((h.created[0] as { opts: unknown }).opts).toEqual({ threads: 1, hash: 32 })
    calls[1].onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    await flush()
    expect(calls[3]).toMatchObject({ fen: 'd', worker: calls[1].worker }) // reuses the freed worker
    for (const c of [calls[0], calls[2], calls[3]]) c.onLines([line(0, ['e2e4']), line(0, ['d2d4'])], 18, true)
    expect((await Promise.all(asks)).map((r) => r?.depth)).toEqual([18, 18, 18, 18])
  })

  it('preempts the lowest-priority running search when every worker is busy', async () => {
    resetEvalScheduler(2)
    manualEngine()
    void ensureEval('backfill', 18, 2, fresh(), { priority: PRIORITY.gradeBackfill })
    void ensureEval('sweep', 18, 2, fresh(), { priority: PRIORITY.sweep })
    await flush()
    void ensureEval('now', 18, 2, fresh(), { priority: PRIORITY.gradeNow })
    await flush()
    expect(calls[1].signal.aborted).toBe(true) // the sweep, not the backfill
    expect(calls[0].signal.aborted).toBe(false)
    expect(calls[2]).toMatchObject({ fen: 'now', worker: calls[1].worker })
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
