import { Engine } from './stockfish'
import { getEval, putEval, type CachedPosition } from './evalCache'
import {
  ENGINE_DEPTH_TIMEOUT_MS, GRADE_ENGINE_HASH_MB, GRADE_ENGINE_THREADS, GRADE_WORKERS_MAX,
} from '../config'

// How one ensureEval call was answered, for the grade trace (engine/gradeTrace.ts).
// `firstFrameMs` covers boot, queueing and waiting out the previous search's stop.
export interface EvalOutcome {
  source: 'cache' | 'search'
  result: 'ok' | 'timeout' | 'aborted' | 'boot-fail'
  ms: number
  depth: number
  engineState: ReturnType<Engine['getStatus']>['state']
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
  worker: Engine | null
  startedAt: number
  firstFrameAt?: number
  reached: number
  timer?: ReturnType<typeof setTimeout>
}

// The scheduler: one queue of depth searches over a pool of single-thread workers.
// Identical asks share a search; a caller that leaves never stops it — only a job
// someone still waits on takes its worker (docs/specs/2026-10-04-fast-deviation-grading).
const jobs = new Set<Job>()
const running = new Map<Engine, Job>()
const pool: Engine[] = []
let poolSize: number | null = null
let seq = 0
let pumpQueued = false

const prio = (j: Job) => Math.min(...[...j.subs].map((s) => s.priority))

// Spare one core for the page and Analysis, but always at least one worker.
function size(): number {
  poolSize ??= Math.max(1, Math.min((navigator.hardwareConcurrency ?? 2) - 1, GRADE_WORKERS_MAX))
  return poolSize
}

function freeWorker(): Engine | null {
  const idle = pool.find((w) => !running.has(w))
  if (idle) return idle
  if (pool.length >= size()) return null
  const w = new Engine({ threads: GRADE_ENGINE_THREADS, hash: GRADE_ENGINE_HASH_MB })
  pool.push(w)
  return w
}

function poolState(): EvalOutcome['engineState'] {
  const states = pool.map((w) => w.getStatus().state)
  return (['ready', 'booting', 'error'] as const).find((st) => states.includes(st)) ?? 'idle'
}

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

function release(job: Job) {
  clearTimeout(job.timer)
  if (job.worker) running.delete(job.worker)
  job.worker = null
  job.ctrl = null
}

function finish(job: Job) {
  release(job)
  jobs.delete(job)
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
  for (;;) {
    let best: Job | null = null
    for (const j of jobs) {
      if (j.worker || j.subs.size === 0) continue
      if (!best || prio(j) < prio(best) || (prio(j) === prio(best) && j.seq < best.seq)) best = j
    }
    if (!best) return
    let worker = freeWorker()
    if (!worker) {
      // Orphans yield to anyone; a waited-on search only to strictly higher priority.
      const rank = (j: Job) => (j.subs.size === 0 ? Infinity : prio(j))
      const victim = [...running.values()].reduce((a, b) => (rank(b) > rank(a) ? b : a))
      if (rank(victim) <= prio(best)) return
      worker = victim.worker!
      victim.ctrl?.abort()
      release(victim)
      if (victim.subs.size === 0) jobs.delete(victim)
    }
    start(best, worker)
  }
}

function start(job: Job, worker: Engine) {
  running.set(worker, job)
  job.worker = worker
  job.ctrl = new AbortController()
  job.startedAt = performance.now()
  job.reached = 0
  job.firstFrameAt = undefined
  const ctrl = job.ctrl
  const live = () => job.ctrl === ctrl
  job.timer = setTimeout(() => {
    if (!live()) return
    job.subs.forEach((s) => settle(job, s, null, 'timeout'))
    ctrl.abort()
    finish(job)
  }, ENGINE_DEPTH_TIMEOUT_MS)
  worker
    .analyze(job.fen, { kind: 'depth', depth: job.depth }, job.multipv, (lines, d, final) => {
      if (!live()) return
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
      // The worker dropped it (a failed respawn): requeue with its waiters.
      if (!live()) return
      release(job)
      if (job.subs.size === 0) jobs.delete(job)
      schedulePump()
    })
    .catch(() => {
      if (!live()) return
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
  const engineState = poolState()
  const hit = getEval(fen, multipv, depth)
  if (hit) {
    opts.onOutcome?.({ source: 'cache', result: 'ok', ms: 0, depth: hit.depth, engineState })
    return Promise.resolve(hit)
  }
  if (signal.aborted) return Promise.resolve(null)

  return new Promise((resolve) => {
    let job = [...jobs].find((j) => j.fen === fen && j.depth >= depth && j.multipv >= multipv)
    const shared = job != null
    if (!job) {
      job = { fen, depth, multipv, subs: new Set(), seq: seq++, ctrl: null, worker: null, startedAt: 0, reached: 0 }
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
      if (owner.subs.size === 0 && !owner.worker) jobs.delete(owner)
      schedulePump()
    })
    schedulePump()
  })
}

/** Test seam: forget every job and worker; `workers` fixes the pool size. */
export function resetEvalScheduler(workers?: number): void {
  jobs.forEach((j) => { j.ctrl?.abort(); clearTimeout(j.timer) })
  jobs.clear()
  running.clear()
  pool.length = 0
  poolSize = workers ?? null
  pumpQueued = false
}
