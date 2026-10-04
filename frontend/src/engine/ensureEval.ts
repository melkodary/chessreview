import { engine } from './stockfish'
import { getEval, putEval, type CachedPosition } from './evalCache'
import { ENGINE_DEPTH_TIMEOUT_MS } from '../config'

// How one ensureEval call was answered, for the grade trace (engine/gradeTrace.ts).
// `firstFrameMs` covers boot, queueing and waiting out the previous search's stop.
export interface EvalOutcome {
  source: 'cache' | 'search'
  result: 'ok' | 'timeout' | 'aborted' | 'boot-fail'
  ms: number
  depth: number
  engineState: ReturnType<typeof engine.getStatus>['state']
  firstFrameMs?: number
  // Waited for a worker before its search started; joined a search already queued or running.
  queuedMs?: number
  shared?: boolean
}

// Lower runs first. The grader asks for the newest ply's positions at gradeNow and
// the rest at gradeBackfill; the sweep (nobody waits on it) yields to both.
export const PRIORITY = { gradeNow: 0, gradeBackfill: 1, speculate: 2, sweep: 3 } as const

interface Sub {
  depth: number
  multipv: number
  priority: number
  requestedAt: number
  shared: boolean
  engineState: EvalOutcome['engineState']
  resolve: (v: CachedPosition | null) => void
  onOutcome?: (o: EvalOutcome) => void
}

interface Job {
  fen: string
  depth: number
  multipv: number
  subs: Set<Sub>
  seq: number
  ctrl: AbortController | null // set while running
  startedAt: number
  firstFrameAt?: number
  reached: number
  timer?: ReturnType<typeof setTimeout>
}

// The scheduler: one queue of depth searches shared by every caller. Identical
// asks share one search; a caller that leaves never stops it — only a job someone
// still waits on takes the worker (docs/specs/2026-10-04-fast-deviation-grading).
const jobs = new Set<Job>()
let running: Job | null = null
// Something outside the queue (Analysis) holds the engine: wait for its idle.
let externalBusy = false
let seq = 0
let pumpQueued = false
let idleHooked = false

const prio = (j: Job) => Math.min(...[...j.subs].map((s) => s.priority))

function settle(job: Job, sub: Sub, v: CachedPosition | null, result: EvalOutcome['result']) {
  job.subs.delete(sub)
  const now = performance.now()
  const started = job.ctrl || job.firstFrameAt != null ? job.startedAt : undefined
  sub.onOutcome?.({
    source: 'search', result, ms: now - sub.requestedAt, depth: job.reached,
    engineState: sub.engineState, shared: sub.shared,
    firstFrameMs: job.firstFrameAt != null ? Math.max(0, job.firstFrameAt - sub.requestedAt) : undefined,
    queuedMs: started != null ? Math.max(0, started - sub.requestedAt) : undefined,
  })
  sub.resolve(v)
}

function finish(job: Job) {
  clearTimeout(job.timer)
  jobs.delete(job)
  if (running === job) running = null
  schedulePump()
}

// Microtask-deferred so a React cleanup + re-run (leave, then rejoin the same
// position) lands before the queue decides anything: the running search survives.
function schedulePump() {
  if (pumpQueued) return
  pumpQueued = true
  void Promise.resolve().then(() => { pumpQueued = false; pump() })
}

function pump() {
  if (externalBusy) return
  let best: Job | null = null
  for (const j of jobs) {
    if (j === running || j.subs.size === 0) continue
    if (!best || prio(j) < prio(best) || (prio(j) === prio(best) && j.seq < best.seq)) best = j
  }
  if (!best) return
  if (running) {
    // An orphan yields to anyone; a waited-on search only to strictly higher priority.
    if (running.subs.size > 0 && prio(best) >= prio(running)) return
    const prev = running
    running = null
    clearTimeout(prev.timer)
    prev.ctrl?.abort()
    prev.ctrl = null
    if (prev.subs.size === 0) jobs.delete(prev)
  }
  start(best)
}

function start(job: Job) {
  running = job
  job.ctrl = new AbortController()
  job.startedAt = performance.now()
  job.reached = 0
  job.firstFrameAt = undefined
  const ctrl = job.ctrl
  job.timer = setTimeout(() => {
    if (running !== job) return
    job.subs.forEach((s) => settle(job, s, null, 'timeout'))
    ctrl.abort()
    finish(job)
  }, ENGINE_DEPTH_TIMEOUT_MS)
  engine
    .analyze(job.fen, { kind: 'depth', depth: job.depth }, job.multipv, (lines, d, final) => {
      if (running !== job) return
      job.firstFrameAt ??= performance.now()
      job.reached = Math.max(job.reached, d)
      putEval(job.fen, lines, d, job.multipv)
      for (const s of job.subs) {
        if (d >= s.depth) settle(job, s, { lines, depth: d, multipv: job.multipv }, 'ok')
      }
      // A search that ends short of depth (it shouldn't) fails its waiters, not hangs them.
      if (final) {
        job.subs.forEach((s) => settle(job, s, null, 'timeout'))
        finish(job)
      } else if (d >= job.depth) {
        finish(job)
      }
    }, ctrl.signal, () => {
      // Another consumer took the engine: requeue with the waiters, resume on idle.
      if (running !== job) return
      running = null
      clearTimeout(job.timer)
      job.ctrl = null
      externalBusy = true
      if (job.subs.size === 0) jobs.delete(job)
    })
    .catch(() => {
      if (running !== job) return
      job.subs.forEach((s) => settle(job, s, null, 'boot-fail'))
      finish(job)
    })
}

// An eval at >= `depth` / `multipv`: cached, else a queued depth search (the classifier's
// depth, so browser grades match the backend's). Null on abort, boot failure, or
// ENGINE_DEPTH_TIMEOUT_MS of running time short of depth → the backend searches.
export function ensureEval(
  fen: string,
  depth: number,
  multipv: number,
  signal: AbortSignal,
  opts: { priority?: number; onOutcome?: (o: EvalOutcome) => void } = {},
): Promise<CachedPosition | null> {
  const engineState = engine.getStatus().state
  const hit = getEval(fen, multipv, depth)
  if (hit) {
    opts.onOutcome?.({ source: 'cache', result: 'ok', ms: 0, depth: hit.depth, engineState })
    return Promise.resolve(hit)
  }
  if (signal.aborted) return Promise.resolve(null)
  if (!idleHooked) {
    idleHooked = true
    engine.onIdle(() => { externalBusy = false; schedulePump() })
  }

  return new Promise((resolve) => {
    let job = [...jobs].find((j) => j.fen === fen && j.depth >= depth && j.multipv >= multipv)
    const shared = job != null
    if (!job) {
      job = { fen, depth, multipv, subs: new Set(), seq: seq++, ctrl: null, startedAt: 0, reached: 0 }
      jobs.add(job)
    }
    const owner = job
    const sub: Sub = {
      depth, multipv, priority: opts.priority ?? PRIORITY.sweep, requestedAt: performance.now(),
      shared, engineState, resolve, onOutcome: opts.onOutcome,
    }
    owner.subs.add(sub)
    signal.addEventListener('abort', () => {
      if (!owner.subs.has(sub)) return
      settle(owner, sub, null, 'aborted')
      if (owner.subs.size === 0 && running !== owner) jobs.delete(owner)
      schedulePump()
    })
    schedulePump()
  })
}

/** Test seam: forget every queued and running job. */
export function resetEvalScheduler(): void {
  running?.ctrl?.abort()
  jobs.forEach((j) => clearTimeout(j.timer))
  jobs.clear()
  running = null
  externalBusy = false
  pumpQueued = false
}
