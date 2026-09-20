import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'
import { ANALYSIS_DEPTH_CEILING } from '../config'
import type { SearchLimit } from './stockfish'

// Minimal Worker mock: captures posted commands, lets the test drive the UCI
// handshake by emitting synthetic message events, and tracks terminate() calls
// so teardown can be asserted directly.
class FakeWorker {
  posted: string[] = []
  terminate = vi.fn()
  onerror: ((e: { message?: string }) => void) | null = null
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {}

  constructor() {
    workerInstances.push(this)
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb)
  }

  removeEventListener(type: string, cb: (e: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb)
  }

  postMessage(cmd: string) {
    this.posted.push(cmd)
  }

  emit(line: string) {
    for (const cb of this.listeners.message ?? []) cb({ data: line } as MessageEvent)
  }
}

let workerInstances: FakeWorker[] = []

beforeEach(() => {
  workerInstances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Drive a booting worker through the uci/isready handshake to completion. */
function completeHandshake(w: FakeWorker) {
  w.emit('uciok')
  w.emit('readyok')
}

describe('engine.configure', () => {
  it('tears down an existing worker (terminate called, state nulled so next analyze reboots)', async () => {
    const { engine } = await import('./stockfish')

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker1 = workerInstances[0]
    completeHandshake(worker1)
    await analyzePromise

    engine.configure({ threads: 4, hash: 128 })

    expect(worker1.terminate).toHaveBeenCalled()

    const analyzePromise2 = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker2 = workerInstances[1]
    completeHandshake(worker2)
    await analyzePromise2

    expect(worker2).not.toBe(worker1)
  })

  it('keeps the worker when threads/hash are unchanged (a tab remount is not a reconfigure)', async () => {
    const { engine } = await import('./stockfish')

    engine.configure({ threads: 4, hash: 128 })
    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker1 = workerInstances[0]
    completeHandshake(worker1)
    await analyzePromise

    engine.configure({ threads: 4, hash: 128 })

    expect(worker1.terminate).not.toHaveBeenCalled()
    expect(engine.getStatus().state).toBe('ready')
  })

  it('applies configured threads/hash to the next boot setoption calls', async () => {
    const { engine } = await import('./stockfish')

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    completeHandshake(workerInstances[0])
    await analyzePromise

    engine.configure({ threads: 4, hash: 128 })

    const analyzePromise2 = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker2 = workerInstances[1]
    completeHandshake(worker2)
    await analyzePromise2

    expect(worker2.posted).toContain('setoption name Threads value 4')
    expect(worker2.posted).toContain('setoption name Hash value 128')
  })

  it('updates holders without tearing down when no worker exists yet', async () => {
    const { engine } = await import('./stockfish')

    engine.configure({ threads: 3, hash: 256 })

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker = workerInstances[0]
    completeHandshake(worker)
    await analyzePromise

    expect(worker.posted).toContain('setoption name Threads value 3')
    expect(worker.posted).toContain('setoption name Hash value 256')
  })
})

describe('engine status', () => {
  it('transitions idle -> booting -> ready across a boot, and back to idle on teardown', async () => {
    const { engine } = await import('./stockfish')

    expect(engine.getStatus().state).toBe('idle')

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    expect(engine.getStatus().state).toBe('booting')

    completeHandshake(workerInstances[0])
    await analyzePromise
    expect(engine.getStatus().state).toBe('ready')

    engine.configure({ threads: 4 })
    expect(engine.getStatus().state).toBe('idle')
  })

  it('notifies subscribers on every state change', async () => {
    const { engine } = await import('./stockfish')
    const cb = vi.fn()
    const unsubscribe = engine.onStatusChange(cb)

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    completeHandshake(workerInstances[0])
    await analyzePromise

    expect(cb).toHaveBeenCalled()
    const callsBeforeUnsub = cb.mock.calls.length
    unsubscribe()
    engine.configure({ threads: 2 })
    expect(cb.mock.calls.length).toBe(callsBeforeUnsub)
  })

  it('sets error state when the worker fires onerror during boot', async () => {
    const { engine } = await import('./stockfish')

    const analyzePromise = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {}).catch(() => {})
    const worker = workerInstances[0]
    worker.onerror?.({ message: 'boom' })
    await analyzePromise

    expect(engine.getStatus().state).toBe('error')
  })

  it('times out a silent worker and retries with a fresh worker', async () => {
    vi.useFakeTimers()
    const { engine } = await import('./stockfish')

    const first = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker1 = workerInstances[0]
    const rejection = expect(first).rejects.toThrow('engine boot timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection

    expect(worker1.terminate).toHaveBeenCalledOnce()
    expect(engine.getStatus().state).toBe('error')

    const second = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const worker2 = workerInstances[1]
    completeHandshake(worker2)
    await second
    expect(worker2).not.toBe(worker1)
  })

  it('cancels a boot timer before a configured retry', async () => {
    vi.useFakeTimers()
    const { engine } = await import('./stockfish')
    engine.configure({ threads: 1 })

    const first = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    const canceled = expect(first).rejects.toThrow('engine boot canceled')
    engine.configure({ threads: 2 })
    await canceled

    const second = engine.analyze('startpos', { kind: 'depth', depth: 18 }, 1, () => {})
    completeHandshake(workerInstances[1])
    await second
    await vi.advanceTimersByTimeAsync(10_000)
    expect(engine.getStatus().state).toBe('ready')
  })

})

describe('search limit dispatch', () => {
  /** Boot, get past the isready barrier, and return the `go` the engine sent. */
  async function goFor(limit: SearchLimit): Promise<string> {
    const { engine } = await import('./stockfish')
    const promise = engine.analyze('startpos', limit, 1, () => {})
    const worker = workerInstances[0]
    completeHandshake(worker)
    await promise
    worker.emit('readyok')
    return worker.posted.find((c) => c.startsWith('go '))!
  }

  it('sends `go depth N` for a depth limit', async () => {
    expect(await goFor({ kind: 'depth', depth: 18 })).toBe('go depth 18')
  })

  it('rides the ceiling along on a movetime limit so a solved position exits early', async () => {
    expect(await goFor({ kind: 'movetime', ms: 20_000 })).toBe(
      `go movetime 20000 depth ${ANALYSIS_DEPTH_CEILING}`,
    )
  })
})

describe('multipv streaming', () => {
  // White to move, from the game that surfaced the bug (17...Rb8).
  const FEN = '1rb2rk1/p4ppp/2Q1p3/3pP3/4nP2/2P5/PP2BqPP/R2K3R w - - 1 18'

  /** Boot the engine and get its search running (past the isready barrier). */
  async function startSearch(
    multipv: number,
    onLines: (lines: AnalysisLine[], depth: number, final: boolean) => void,
  ) {
    const { engine } = await import('./stockfish')
    const promise = engine.analyze(FEN, { kind: 'movetime', ms: 20_000 }, multipv, onLines)
    const worker = workerInstances[0]
    completeHandshake(worker)
    await promise
    worker.emit('readyok') // barrier ack -> `go` dispatched
    return worker
  }

  it('never regresses the reported depth on Stockfish\'s stale depth-1 PV replays', async () => {
    const seen: number[] = []
    const worker = await startSearch(3, (_lines, depth) => seen.push(depth))

    // A complete depth-19 iteration, then a depth-20 frame: Stockfish reprints
    // every slot each frame, tagging PVs it has not re-searched with depth-1.
    worker.emit('info depth 19 multipv 1 score cp -1107 pv b2b4 f2f4')
    worker.emit('info depth 19 multipv 2 score cp -1338 pv c6a8 f2f4')
    worker.emit('info depth 19 multipv 3 score cp -1589 pv b2b3 f2f4')
    worker.emit('info depth 20 multipv 1 score cp -1158 pv b2b4 f2f4')
    worker.emit('info depth 19 multipv 2 score cp -1338 pv c6a8 f2f4')
    worker.emit('info depth 19 multipv 3 score cp -1589 pv b2b3 f2f4')
    worker.emit('info depth 20 multipv 2 score cp -1611 pv b2b3 f2f4')
    worker.emit('info depth 20 multipv 3 score mate -9 pv a2a4 f2f4')
    worker.emit('bestmove b2b4')

    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(seen.at(-1)).toBe(20)
  })

  it('flushes one frame per completed depth, not once per stale replay', async () => {
    const frames: { depth: number; final: boolean }[] = []
    const worker = await startSearch(3, (_lines, depth, final) => frames.push({ depth, final }))

    worker.emit('info depth 19 multipv 1 score cp -1107 pv b2b4 f2f4')
    worker.emit('info depth 19 multipv 2 score cp -1338 pv c6a8 f2f4')
    worker.emit('info depth 20 multipv 1 score cp -1158 pv b2b4 f2f4')
    worker.emit('info depth 19 multipv 2 score cp -1338 pv c6a8 f2f4')
    worker.emit('info depth 20 multipv 1 score cp -1158 pv b2b4 f2f4')
    worker.emit('info depth 19 multipv 2 score cp -1338 pv c6a8 f2f4')

    expect(frames.filter((f) => !f.final)).toEqual([{ depth: 19, final: false }])
  })

  it('keeps a stale replay from overwriting the deeper line already in a slot', async () => {
    const frames: { lines: { mate: number | null }[]; depth: number }[] = []
    const worker = await startSearch(3, (lines, depth) =>
      frames.push({ lines: lines as { mate: number | null }[], depth }))

    worker.emit('info depth 20 multipv 1 score cp -1158 pv b2b4 f2f4')
    worker.emit('info depth 20 multipv 2 score cp -1611 pv b2b3 f2f4')
    worker.emit('info depth 20 multipv 3 score mate -9 pv a2a4 f2f4')
    // Stockfish's depth-21 frame replays slot 3 at depth 20 with its old score.
    worker.emit('info depth 21 multipv 1 score cp -1200 pv b2b4 f2f4')
    worker.emit('info depth 20 multipv 3 score mate -9 pv a2a4 f2f4')
    worker.emit('bestmove b2b4')

    const last = frames.at(-1)!
    expect(last.depth).toBe(21)
    expect(last.lines[2].mate).toBe(-9)
  })

  it('keeps the full top line when a same-depth final update carries only its root move', async () => {
    const frames: { lines: AnalysisLine[]; final: boolean }[] = []
    const worker = await startSearch(3, (lines, _depth, final) => frames.push({ lines, final }))

    worker.emit('info depth 28 multipv 1 score cp -31 pv b2b4 f2f4')
    worker.emit('info depth 28 multipv 2 score cp -28 pv c6a8 f2f4')
    worker.emit('info depth 28 multipv 3 score cp -25 pv b2b3 f2f4')
    worker.emit('info depth 28 multipv 1 score cp -30 pv b2b4')
    worker.emit('bestmove b2b4')

    const final = frames.at(-1)!
    expect(final.final).toBe(true)
    expect(final.lines[0].evaluation).toBe(-0.3)
    expect(final.lines[0].moves).toEqual(['b4', 'Qxf4'])
    expect(final.lines[0].pvUci).toEqual(['b2b4', 'f2f4'])
  })

  it('keeps full PVs by root move when deeper MultiPV rankings reorder', async () => {
    const frames: { lines: AnalysisLine[]; depth: number; final: boolean }[] = []
    const worker = await startSearch(3, (lines, depth, final) =>
      frames.push({ lines, depth, final }))

    worker.emit('info depth 23 multipv 1 score cp -31 pv b2b4 f2f4')
    worker.emit('info depth 23 multipv 2 score cp -28 pv c6a8 f2f4')
    worker.emit('info depth 23 multipv 3 score cp -25 pv b2b3 f2f4')
    worker.emit('info depth 24 multipv 1 score cp -27 pv c6a8 f2f4')
    worker.emit('info depth 24 multipv 2 score cp -30 pv b2b4')
    worker.emit('info depth 24 multipv 3 score cp -24 pv b2b3 f2f4')
    worker.emit('bestmove c6a8')

    const final = frames.at(-1)!
    expect(final.depth).toBe(24)
    expect(final.final).toBe(true)
    expect(final.lines[1].evaluation).toBe(-0.3)
    expect(final.lines[1].moves).toEqual(['b4', 'Qxf4'])
    expect(final.lines[1].pvUci).toEqual(['b2b4', 'f2f4'])
  })

  it('does not borrow a continuation when a slot changes to a new root move', async () => {
    const frames: AnalysisLine[][] = []
    const worker = await startSearch(2, (lines) => frames.push(lines))

    worker.emit('info depth 23 multipv 1 score cp -31 pv b2b4 f2f4')
    worker.emit('info depth 23 multipv 2 score cp -28 pv c6a8 f2f4')
    worker.emit('info depth 24 multipv 1 score cp -27 pv c6a8 f2f4')
    worker.emit('info depth 24 multipv 2 score cp -26 pv a2a4')
    worker.emit('bestmove c6a8')

    expect(frames.at(-1)![1].moves).toEqual(['a4'])
    expect(frames.at(-1)![1].pvUci).toEqual(['a2a4'])
  })
})

describe('search supersession', () => {
  const FEN_A = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const FEN_B = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

  // `stop` is answered by the search thread and `isready` by the input thread,
  // so a stopped search's `bestmove` can land after the next search's `go`.
  // Before the staleBestmoves guard that frame was emitted as the new search's
  // final result — zero lines, depth 0 — and orphaned it (current nulled), so
  // the panel settled on "No analysis yet." and never recovered.
  it('drops a stopped search\'s bestmove even when it arrives after the next go', async () => {
    const { engine } = await import('./stockfish')

    const first = engine.analyze(FEN_A, { kind: 'movetime', ms: 20_000 }, 1, () => {})
    const worker = workerInstances[0]
    completeHandshake(worker)
    await first
    worker.emit('readyok')
    worker.emit('info depth 12 multipv 1 score cp 20 pv e2e4 e7e5')

    const framesB: { lines: AnalysisLine[]; depth: number; final: boolean }[] = []
    const second = engine.analyze(FEN_B, { kind: 'movetime', ms: 20_000 }, 1,
      (lines, depth, final) => framesB.push({ lines, depth, final }))
    await second

    // readyok wins the race: the new search is promoted and its `go` dispatched.
    worker.emit('readyok')
    // ...and only now does the first search's bestmove arrive.
    worker.emit('bestmove e2e4')
    expect(framesB).toEqual([])

    worker.emit('info depth 14 multipv 1 score cp -15 pv e7e5 g1f3')
    worker.emit('bestmove e7e5')
    expect(framesB.at(-1)).toMatchObject({ depth: 14, final: true })
    expect(framesB.at(-1)!.lines).toHaveLength(1)
  })

  it('still finalises the new search when the stopped bestmove arrives first', async () => {
    const { engine } = await import('./stockfish')

    const first = engine.analyze(FEN_A, { kind: 'movetime', ms: 20_000 }, 1, () => {})
    const worker = workerInstances[0]
    completeHandshake(worker)
    await first
    worker.emit('readyok')

    const framesB: { final: boolean }[] = []
    const second = engine.analyze(FEN_B, { kind: 'movetime', ms: 20_000 }, 1,
      (_lines, _depth, final) => framesB.push({ final }))
    await second

    worker.emit('bestmove e2e4') // the stopped search, in the expected order
    worker.emit('readyok')
    worker.emit('info depth 14 multipv 1 score cp -15 pv e7e5 g1f3')
    worker.emit('bestmove e7e5')

    expect(framesB.filter((f) => f.final)).toHaveLength(1)
  })
})
