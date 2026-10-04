import type { AnalysisLine } from '../api/analyzer'
import {
  ANALYSIS_DEPTH_CEILING, ENGINE_BOOT_TIMEOUT_MS, ENGINE_PV_DEPTH, ENGINE_STOP_GRACE_MS,
} from '../config'
import { ENGINE_URL, SETTINGS_STORAGE } from '../storage'
import { parseInfo } from './uci'

export type OnLines = (lines: AnalysisLine[], depth: number, final: boolean) => void
type EngineRunState = 'idle' | 'booting' | 'ready' | 'error'

/**
 * What ends the search. Both forms are first-class: Analysis runs on a wall-clock
 * budget (depth is an output there), while the branch grader must reach a specific
 * depth for parity with the backend classifier (see ensureEval).
 */
export type SearchLimit =
  | { kind: 'depth'; depth: number }
  | { kind: 'movetime'; ms: number }

const goCommand = (limit: SearchLimit): string =>
  limit.kind === 'depth'
    ? `go depth ${limit.depth}`
    // Stockfish honours whichever limit lands first, so the ceiling is the early
    // exit on a position that is already solved.
    : `go movetime ${limit.ms} depth ${ANALYSIS_DEPTH_CEILING}`

const activeEngineUrl = ENGINE_URL

interface Search {
  id: number
  fen: string
  limit: SearchLimit
  multipv: number
  onLines: OnLines
  signal?: AbortSignal
  onSuperseded?: () => void
  slots: AnalysisLine[]
  linesByRoot: Map<string, AnalysisLine>
  depth: number
}

function preserveRichestPv(history: Map<string, AnalysisLine>, next: AnalysisLine): AnalysisLine {
  const root = next.pvUci?.[0]
  if (root === undefined) return next
  const previous = history.get(root)
  const merged = previous && previous.moves.length > next.moves.length
    ? { ...next, moves: previous.moves, pvUci: previous.pvUci }
    : next
  history.set(root, merged)
  return merged
}

/**
 * UCI worker wrapper around multi-threaded WASM Stockfish: `engine` (Analysis, the
 * user's Threads/Hash) and ensureEval's grade pool (fixed options). Boots lazily on
 * the first analyze() so the WASM/NNUE download isn't paid until the user opens
 * the analyze tab. Stale-position races are killed with an isready/readyok
 * barrier: `go` is only sent after the engine acknowledges the new position, so
 * trailing frames from a cancelled search are dropped (current is null between
 * stop and barrier) — and by `staleBestmoves`, which the barrier alone cannot do.
 */
export class Engine {
  private worker: Worker | null = null
  private booting: Promise<void> | null = null
  private cancelBoot: (() => void) | null = null
  private reqId = 0
  private pending: Search | null = null
  private current: Search | null = null
  // `bestmove` frames still owed by abandoned searches. `stop` and `isready` are
  // answered by different threads, so a stopped search's `bestmove` can land on
  // the next search as an empty final frame.
  private staleBestmoves = 0
  // Armed while a stopped search still owes its `bestmove`; firing means the
  // engine ignored `stop`, so the worker is replaced (see respawn).
  private staleTimer: ReturnType<typeof setTimeout> | null = null
  private threads: number
  private hash: number
  private state: EngineRunState = 'idle'
  private listeners = new Set<() => void>()

  constructor(fixed?: { threads: number; hash: number }) {
    this.threads = fixed?.threads ?? SETTINGS_STORAGE.engineThreads.load()
    this.hash = fixed?.hash ?? SETTINGS_STORAGE.engineHash.load()
  }

  private send(cmd: string) {
    this.worker!.postMessage(cmd)
  }

  private setState(s: EngineRunState) {
    this.state = s
    this.listeners.forEach((f) => f())
  }

  /** Subscribe to run-state changes (idle/booting/ready/error); returns an unsubscribe fn. */
  onStatusChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Current run state plus the fixed lite-engine URL. */
  getStatus(): { url: string; state: EngineRunState } {
    return { url: activeEngineUrl, state: this.state }
  }

  /** Tear down the live worker so the next analyze() reboots with fresh setoption values. */
  private teardown() {
    const dropped = [this.current, this.pending]
    this.cancelBoot?.()
    this.cancelBoot = null
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.current = null
    this.pending = null
    this.staleBestmoves = 0
    this.clearStaleTimer()
    this.setState('idle')
    dropped.forEach((s) => s?.onSuperseded?.())
  }

  /** A stopped search owes one `bestmove`; give it ENGINE_STOP_GRACE_MS to pay. */
  private owe() {
    this.staleBestmoves++
    this.staleTimer ??= setTimeout(() => this.respawn(), ENGINE_STOP_GRACE_MS)
  }

  private clearStaleTimer() {
    if (this.staleTimer !== null) clearTimeout(this.staleTimer)
    this.staleTimer = null
  }

  // The engine ignored `stop` (once for 80s+) and Stockfish starts no `go` until the
  // old search ends: replace the worker and re-issue the waiting search, so its
  // caller sees a delay, not a hang.
  private respawn() {
    const resume = this.pending ?? this.current
    this.pending = null
    this.current = null
    this.teardown()
    const live = resume && !resume.signal?.aborted ? resume : null
    if (!live) return
    void this.analyze(live.fen, live.limit, live.multipv, live.onLines, live.signal, live.onSuperseded)
      .catch(() => live.onSuperseded?.())
  }

  /**
   * Update Threads/Hash for the next boot. Threads/Hash can only be applied at
   * boot (UCI forbids setoption mid-search), so if a worker is already up this
   * tears it down — the next analyze() reboots and re-sends setoption with the
   * new values. No worker yet? Just update the holders for the first boot.
   */
  configure(next: { threads?: number; hash?: number }) {
    const threads = next.threads ?? this.threads
    const hash = next.hash ?? this.hash
    // Analyze tab remounts call this with the same values; a no-op must not
    // kill a live worker (and its hash) another consumer booted.
    if (threads === this.threads && hash === this.hash) return
    this.threads = threads
    this.hash = hash
    if (this.worker) this.teardown()
  }

  /** Lazy one-time boot + UCI handshake. */
  private boot(): Promise<void> {
    if (this.booting) return this.booting
    const booting = this.bootOnce()
    this.booting = booting
    void booting.catch(() => {
      if (this.booting === booting) this.booting = null
    })
    return booting
  }

  private bootOnce(): Promise<void> {
    this.setState('booting')
    return new Promise<void>((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(activeEngineUrl)
      } catch (e) {
        this.setState('error')
        reject(e instanceof Error ? e : new Error('engine worker failed to start'))
        return
      }
      this.worker = worker

      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null
      let cancelAttempt: (() => void) | null = null
      const cleanup = () => {
        if (timeout !== null) clearTimeout(timeout)
        worker.removeEventListener('message', onBoot)
        if (this.cancelBoot === cancelAttempt) this.cancelBoot = null
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        worker.terminate()
        if (this.worker === worker) this.worker = null
        this.setState('error')
        reject(error)
      }
      cancelAttempt = () => fail(new Error('engine boot canceled'))
      this.cancelBoot = cancelAttempt

      const onBoot = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : ''
        if (line.includes('uciok')) {
          this.send(`setoption name Threads value ${this.threads}`)
          this.send(`setoption name Hash value ${this.hash}`)
          this.send('isready')
        } else if (line.includes('readyok')) {
          if (settled) return
          settled = true
          this.send('ucinewgame')
          cleanup()
          worker.addEventListener('message', this.onMessage)
          worker.onerror = () => this.setState('error')
          this.setState('ready')
          resolve()
        }
      }
      timeout = setTimeout(
        () => fail(new Error('engine boot timed out')),
        ENGINE_BOOT_TIMEOUT_MS,
      )
      worker.addEventListener('message', onBoot)
      worker.onerror = (err) => fail(new Error(err.message || 'engine worker error'))
      this.send('uci')
    })
  }

  private onMessage = (e: MessageEvent) => {
    const line = typeof e.data === 'string' ? e.data : ''

    if (line.startsWith('readyok')) {
      // Barrier ack: promote the latest pending search and start its go.
      if (this.pending) {
        this.current = this.pending
        this.pending = null
        this.send(goCommand(this.current.limit))
      }
      return
    }

    if (line.startsWith('bestmove')) {
      if (this.staleBestmoves > 0) {
        this.staleBestmoves--
        // Progress: the engine is answering stops, so restart the grace window.
        this.clearStaleTimer()
        if (this.staleBestmoves > 0) this.staleTimer = setTimeout(() => this.respawn(), ENGINE_STOP_GRACE_MS)
        return
      }
      if (!this.current) return
      const done = this.current
      this.current = null
      this.emit(done, true)
      return
    }

    if (!this.current) return

    if (line.startsWith('info ')) {
      const parsed = parseInfo(line, this.current.fen, ENGINE_PV_DEPTH)
      if (!parsed) return
      // Stockfish reprints every MultiPV slot each frame, tagging the PVs it
      // has not re-searched at the new depth with `depth - 1` and their prior
      // score. Those replays carry nothing the slots don't already hold, and
      // taking depth from them regresses the badge (19 → 18 → 19 …) and
      // re-fires the flush below on a half-updated slot set.
      if (parsed.depth < this.current.depth) return
      // Depth advanced → flush the now-complete previous depth's slots.
      if (parsed.depth > this.current.depth && this.current.depth > 0) {
        this.emit(this.current, false)
      }
      const slot = parsed.multipv - 1
      this.current.slots[slot] = preserveRichestPv(this.current.linesByRoot, parsed.line)
      this.current.depth = parsed.depth
    }
  }

  private emit(s: Search, final: boolean) {
    const lines = s.slots.slice(0, s.multipv).filter((l): l is AnalysisLine => l != null)
    if (lines.length === 0 && !final) return
    s.onLines(lines, s.depth, final)
  }

  /**
   * Analyze `fen` under `limit` with `multipv` lines. Streams via `onLines`
   * (final=false per depth tick, final=true on bestmove). `signal` aborts the
   * search. Resolves once the search has been dispatched (not when it finishes).
   */
  async analyze(
    fen: string,
    limit: SearchLimit,
    multipv: number,
    onLines: OnLines,
    signal?: AbortSignal,
    // The engine dropped it without `signal` asking: replaced, stop(), or teardown.
    onSuperseded?: () => void,
  ): Promise<void> {
    await this.boot()
    if (signal?.aborted) return

    const id = ++this.reqId
    const search: Search = {
      id, fen, limit, multipv, onLines, signal, onSuperseded,
      slots: [], linesByRoot: new Map(), depth: 0,
    }

    // Cancel any in-flight search; clear current so its trailing frames drop.
    // Only a search whose `go` was sent still owes a `bestmove`; a `pending` one
    // never started.
    const dropped = [this.current, this.pending]
    this.send('stop')
    if (this.current) this.owe()
    this.current = null
    this.pending = search
    this.send(`setoption name MultiPV value ${multipv}`)
    this.send(`position fen ${fen}`)
    this.send('isready') // barrier — go is sent on readyok
    dropped.forEach((s) => s?.onSuperseded?.())

    signal?.addEventListener('abort', () => {
      if (this.pending?.id === id) this.pending = null
      if (this.current?.id === id) {
        this.send('stop')
        this.owe()
        this.current = null
      }
    })
  }

  /** Stop the current search without tearing down the worker. */
  stop() {
    const dropped = [this.current, this.pending]
    if (this.worker) this.send('stop')
    if (this.current) this.owe()
    this.pending = null
    this.current = null
    dropped.forEach((s) => s?.onSuperseded?.())
  }
}

export const engine = new Engine()
