import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'

import { cancelReview, createReview, getReview, listReviews } from '../api/analyzer'
import type { ReviewInboxItem, ReviewMeta, ReviewPayload } from '../api/analyzer'
import type { MoveReview, ReviewSummary } from '../api/review'
import { GRADE_WITH_FRONTEND_ENGINE, REVIEW_ACTIVE_POLL_MS } from '../config'
import { buildReviewPayload } from '../engine/reviewPayload'
import { useSettings } from '../settingsContext'
import { WASM_ENGINE_NAME } from '../storage'

type State = 'idle' | 'hydrating' | 'running' | 'done' | 'error'

interface ReviewConfig {
  depth: number
  multipv: number
}

interface ReviewView {
  state: State
  moves: MoveReview[]
  summary: ReviewSummary | null
  engine: string | null
  // null until a stored row settles it (hydration, or the first poll after
  // create) — a frontend-sourced sweep in progress has no job row yet.
  engineSource: 'backend' | 'frontend' | null
  displayedConfig: ReviewConfig | null
  error: string
  // A frontend-sourced review's pass 2 (the browser sweep at the review's own
  // depth/MultiPV) still running — no job row exists until it submits.
  sweep: ReviewConfig | null
  // Plies pass 2 has evaluated, driving the running view until submission.
  swept: number
}

interface Result extends ReviewView {
  totalPlies: number
  start: () => void
  cancel: () => void
  // Pass 2's lifecycle hooks, for the sweep driver (useProvisionalCurve).
  reportSweep: (plies: number) => void
  submitSweep: (complete: boolean) => void
}

type PendingRun =
  | { kind: 'create'; pgn: string; config: ReviewConfig; meta: ReviewMeta; payload?: ReviewPayload }
  | { kind: 'resume'; jobId: string }

function blankView(
  state: State,
  displayedConfig: ReviewConfig | null = null,
  engine: string | null = null,
): ReviewView {
  return {
    state, moves: [], summary: null, engine, engineSource: null,
    displayedConfig, error: '', sweep: null, swept: 0,
  }
}

// Newest-first within a tier, except a backend row always beats a frontend row
// in the same tier regardless of recency (Phase 2: the backend is authoritative).
function firstPreferBackend(
  jobs: ReviewInboxItem[], predicate: (job: ReviewInboxItem) => boolean,
): ReviewInboxItem | undefined {
  let newestMatch: ReviewInboxItem | undefined
  for (const job of jobs) {
    if (!predicate(job)) continue
    if (job.engineSource === 'backend') return job
    newestMatch ??= job
  }
  return newestMatch
}

export function pickReview(jobs: ReviewInboxItem[], config: ReviewConfig) {
  const matches = (job: ReviewInboxItem) =>
    job.depth === config.depth && job.multipv === config.multipv
  const live = (job: ReviewInboxItem) =>
    job.status === 'running' || job.status === 'queued'
  return firstPreferBackend(jobs, (job) => job.status === 'done' && matches(job)) ??
    firstPreferBackend(jobs, (job) => live(job) && matches(job)) ??
    firstPreferBackend(jobs, (job) => job.status === 'done') ??
    firstPreferBackend(jobs, live)
}

function countPlies(pgn: string): number {
  try {
    const game = new Chess()
    game.loadPgn(pgn)
    return game.history().length
  } catch {
    return 0
  }
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, REVIEW_ACTIVE_POLL_MS)
    signal.addEventListener('abort', done, { once: true })
  })
}

// `positions` (index i = the position after ply i) enable the frontend-sourced
// path: flag on, start() sweeps the game in the browser and submits the evals;
// without them start() queues a backend review exactly as before.
const NO_POSITIONS: { fen: string }[] = []

export function useGameReview(
  pgn: string, meta: ReviewMeta = {}, positions: { fen: string }[] = NO_POSITIONS,
): Result {
  const { reviewDepth, reviewMultiPv, provisionalCurve } = useSettings()
  const [view, setView] = useState(() => blankView(meta.gameId ? 'hydrating' : 'idle'))
  const [runId, setRunId] = useState(0)
  const activeRef = useRef(false)
  const ctrlRef = useRef<AbortController | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const runRef = useRef<PendingRun | null>(null)
  const sweepingRef = useRef(false)
  const selectedConfigRef = useRef({ depth: reviewDepth, multipv: reviewMultiPv })
  const positionsRef = useRef(positions)
  const identityRef = useRef({
    pgn, source: meta.source, userId: meta.userId, gameId: meta.gameId,
  })

  useEffect(() => {
    selectedConfigRef.current = { depth: reviewDepth, multipv: reviewMultiPv }
  }, [reviewDepth, reviewMultiPv])
  useEffect(() => { positionsRef.current = positions }, [positions])

  const totalPlies = useMemo(() => countPlies(pgn), [pgn])
  // The user's browser-engine toggle covers pass 2 as well as the sketch.
  const sweepFirst = GRADE_WITH_FRONTEND_ENGINE && provisionalCurve && positions.length > 0

  const start = useCallback(() => {
    if (activeRef.current) return
    ctrlRef.current?.abort()
    activeRef.current = true
    const config = { depth: reviewDepth, multipv: reviewMultiPv }
    runRef.current = {
      kind: 'create',
      pgn,
      config,
      meta: { source: meta.source, userId: meta.userId, gameId: meta.gameId },
    }
    // Pass 2 first: the run effect fires from submitSweep, not from here.
    sweepingRef.current = sweepFirst
    setView({ ...blankView('running', config), sweep: sweepFirst ? config : null })
    if (!sweepFirst) setRunId((id) => id + 1)
  }, [pgn, reviewDepth, reviewMultiPv, meta.source, meta.userId, meta.gameId, sweepFirst])

  const reportSweep = useCallback((plies: number) => {
    setView((current) => (current.sweep ? { ...current, swept: plies } : current))
  }, [])

  // Pass 2 finished (or gave up): submit. A complete sweep sends the cached
  // evals; anything short sends none, and the backend searches.
  const submitSweep = useCallback((complete: boolean) => {
    const run = runRef.current
    if (!sweepingRef.current || !run || run.kind !== 'create') return
    sweepingRef.current = false
    const plies = complete
      ? buildReviewPayload(positionsRef.current, run.config.depth, run.config.multipv)
      : null
    runRef.current = { ...run, payload: plies ? { plies, engine: WASM_ENGINE_NAME } : undefined }
    setView((current) => ({ ...current, sweep: null, swept: 0 }))
    setRunId((id) => id + 1)
  }, [])

  // Reset and attach once per game identity. Settings edits deliberately leave the
  // displayed or running review alone.
  useEffect(() => {
    const previous = identityRef.current
    const changed = previous.pgn !== pgn ||
      previous.source !== meta.source ||
      previous.userId !== meta.userId ||
      previous.gameId !== meta.gameId
    identityRef.current = {
      pgn, source: meta.source, userId: meta.userId, gameId: meta.gameId,
    }
    ctrlRef.current?.abort()
    activeRef.current = false
    sweepingRef.current = false
    jobIdRef.current = null
    runRef.current = null
    if (changed) setView(blankView(meta.gameId ? 'hydrating' : 'idle'))
    if (!meta.gameId) return

    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const config = selectedConfigRef.current
    ;(async () => {
      try {
        const jobs = await listReviews(meta.source, meta.userId, meta.gameId)
        if (ctrl.signal.aborted) return
        const pick = pickReview(jobs, config)
        if (!pick) {
          setView(blankView('idle'))
          return
        }
        jobIdRef.current = pick.id
        runRef.current = { kind: 'resume', jobId: pick.id }
        activeRef.current = true
        setView({
          ...blankView('running', { depth: pick.depth, multipv: pick.multipv }, pick.engine),
          engineSource: pick.engineSource,
        })
        setRunId((id) => id + 1)
      } catch {
        if (!ctrl.signal.aborted) setView(blankView('idle'))
      }
    })()

    return () => ctrl.abort()
  }, [pgn, meta.source, meta.userId, meta.gameId])

  useEffect(() => {
    const run = runRef.current
    if (runId === 0 || !run) return
    const ctrl = new AbortController()
    ctrlRef.current = ctrl

    ;(async () => {
      try {
        let id: string
        if (run.kind === 'create') {
          const job = await createReview(
            run.pgn,
            run.config.depth,
            run.config.multipv,
            run.meta,
            run.payload,
          )
          if (ctrl.signal.aborted) return
          id = job.id
          setView((current) => ({ ...current, engine: job.engine }))
        } else {
          id = run.jobId
        }
        jobIdRef.current = id

        while (!ctrl.signal.aborted) {
          const review = await getReview(id, ctrl.signal)
          if (ctrl.signal.aborted) return
          const snapshot = {
            engine: review.engine, engineSource: review.engineSource, moves: review.moves,
          }
          if (review.status === 'done') {
            if (review.summary === null) {
              setView((current) => ({
                ...current, ...snapshot, state: 'error', error: 'Review failed',
              }))
            } else {
              setView((current) => ({
                ...current, ...snapshot, state: 'done', summary: review.summary,
              }))
            }
            return
          }
          if (review.status === 'error') {
            setView((current) => ({
              ...current,
              ...snapshot,
              state: 'error',
              error: review.error ?? 'Review failed',
            }))
            return
          }
          if (review.status === 'canceled') {
            setView((current) => ({ ...current, ...snapshot, state: 'idle' }))
            return
          }
          setView((current) => ({ ...current, ...snapshot }))
          await waitForNextPoll(ctrl.signal)
        }
      } catch (err: unknown) {
        if (ctrl.signal.aborted) return
        const error = err instanceof Error ? err.message : 'Review failed'
        setView((current) => ({ ...current, state: 'error', error }))
      } finally {
        if (!ctrl.signal.aborted) activeRef.current = false
      }
    })()

    return () => ctrl.abort()
  }, [runId])

  const cancel = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    activeRef.current = false
    sweepingRef.current = false
    runRef.current = null
    if (jobIdRef.current) {
      void cancelReview(jobIdRef.current)
      jobIdRef.current = null
    }
    setView((current) => ({ ...current, state: 'idle', sweep: null, swept: 0 }))
  }, [])

  return { ...view, totalPlies, start, cancel, reportSweep, submitSweep }
}
