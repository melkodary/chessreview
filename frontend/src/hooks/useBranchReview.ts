import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { ExploreNode } from './useBoardExploration'
import type { MoveReview } from '../api/review'
import { gradeMove, type GradeLine, type GradeMoveEval } from '../api/analyzer'
import { ensureEval, PRIORITY } from '../engine/ensureEval'
import { beginAttempt, noteNeeded, recordGrade, type GradeTrace } from '../engine/gradeTrace'
import { beforeLinesFrom, isTerminalFen, scoreOf } from '../engine/reviewPayload'
import { GRADE_WITH_FRONTEND_ENGINE } from '../config'
import { REVIEW_ENGINE_NAME, WASM_ENGINE_NAME } from '../storage'

// One branch ply's grading status. `fen` (the node's resulting FEN) is the
// identity used to keep a verdict across branch edits — a still-matching node
// keeps its grade when the branch is truncated/extended elsewhere.
export interface BranchGrade {
  fen: string
  status: 'pending' | 'done' | 'error'
  review?: MoveReview
}

interface Params {
  branch: ExploreNode[] // explored half-moves (empty ⇒ not exploring)
  forkFen: string // the game node the branch deviates from (branch[0] is played here)
  forkPly: number // moveIndex — the game ply the fork sits at (0 ⇒ start position)
  gameMoves: MoveReview[] // the whole-game review, for seeding branch[0]'s before_opp
  whiteElo?: number
  blackElo?: number
  depth: number
  multipv: number
  reviewEngine: string | null
  enabled: boolean // only grade on the Review tab while exploring
}

// Stable identity for "not exploring" (mirrors useBoardExploration's EMPTY
// sentinel): a fresh `[]` literal on every idle render would change reference
// on every render, defeating any consumer's useMemo/useEffect deps built on
// this array (useReviewOverlay's eval-bar memo among them).
const EMPTY_GRADES: BranchGrade[] = []

// Same major version either side, so a branch grade may mix nets (2026-07-16).
export function gradesWithBrowserEvals(reviewEngine: string | null): boolean {
  return GRADE_WITH_FRONTEND_ENGINE && (reviewEngine === REVIEW_ENGINE_NAME || reviewEngine === WASM_ENGINE_NAME)
}

// One ply's frontend-eval payload, or {} to let the backend search. A terminal
// after-position needs no after-eval (the backend synthesizes it); `prevFen`'s
// rank-1 score is the ply's seed.
async function frontendEvalPayload(
  predFen: string, afterFen: string, prevFen: string | null, depth: number, multipv: number,
  reviewEngine: string | null, signal: AbortSignal, trace: Partial<GradeTrace>, priority: number,
): Promise<{ beforeLines?: GradeLine[]; afterEval?: GradeMoveEval; prevBefore?: GradeMoveEval }> {
  if (!gradesWithBrowserEvals(reviewEngine)) {
    trace.feSkip = GRADE_WITH_FRONTEND_ENGINE ? 'engine-mismatch' : 'flag-off'
    trace.reviewEngine = reviewEngine
    return {}
  }
  const terminal = isTerminalFen(afterFen)
  const [before, after, prev] = await Promise.all([
    ensureEval(predFen, depth, multipv, signal, { priority, onOutcome: (o) => { trace.before = o } }),
    terminal ? null : ensureEval(afterFen, depth, multipv, signal, { priority, onOutcome: (o) => { trace.after = o } }),
    prevFen ? ensureEval(prevFen, depth, multipv, signal, { priority }) : null,
  ])
  if (terminal) trace.after = 'terminal'
  const prevBefore = prev?.lines[0] ? scoreOf(prev.lines[0]) : undefined
  const beforeLines = before ? beforeLinesFrom(before) : null
  if (!beforeLines) return { prevBefore }
  if (terminal) return { beforeLines, prevBefore }
  if (!after?.lines[0]) return { prevBefore }
  return { beforeLines, afterEval: scoreOf(after.lines[0]), prevBefore }
}

// Grades an exploration branch through the backend classifier (POST /reviews/move).
// Plies are independent given evals: the newest ply's positions are searched first,
// older ones backfill, and a branch edit's re-ask rejoins searches still running.
export function useBranchReview({
  branch, forkFen, forkPly, gameMoves, whiteElo, blackElo, depth, multipv,
  reviewEngine, enabled,
}: Params): BranchGrade[] {
  const [grades, setGrades] = useState<BranchGrade[]>([])
  // Mirror of the committed grades, read at the start of a grading pass to
  // carry forward verdicts that survived a branch edit.
  const latest = useRef<BranchGrade[]>([])
  useEffect(() => { latest.current = grades }, [grades])
  // Grade-trace bookkeeping: the inputs the last effect run saw, and what has
  // changed since the last pass started (a pass cancelled before it ran keeps them).
  const lastInputs = useRef<Record<string, unknown> | null>(null)
  const pendingCauses = useRef(new Set<string>())

  const branchKey = branch.map((n) => n.fen).join('|')
  // branch[0]'s before_opp seed: the eval before the game's fork-incoming ply.
  // None at the start position (no prior ply to swing from).
  const seedEval = useMemo(() => {
    if (forkPly <= 0) return undefined
    return gameMoves.find((m) => m.ply === forkPly)?.evalBefore
  }, [gameMoves, forkPly])

  useEffect(() => {
    // Idle when not exploring: leave state untouched (the hook returns [] below)
    // and grade nothing. Re-enabling reconciles against whatever survived, so a
    // tab toggle that keeps the same branch doesn't re-grade it.
    const inputs: Record<string, unknown> = {
      enabled, branch: branchKey, seedEval, whiteElo, blackElo, depth, multipv,
      reviewEngine, forkFen, forkPly,
    }
    const prevInputs = lastInputs.current
    if (prevInputs) {
      for (const k in inputs) if (inputs[k] !== prevInputs[k]) pendingCauses.current.add(k)
    }
    lastInputs.current = inputs
    if (!enabled || branch.length === 0) return
    branch.forEach((n) => noteNeeded(n.fen))
    const ctrl = new AbortController()
    let cancelled = false

    // A microtask, not the effect body: setState is async here, as the repo's hook rules want.
    void Promise.resolve().then(() => {
      if (cancelled) return
      // Reconcile: keep done verdicts whose node still matches by FEN, else
      // reset to pending (a diverged position must be re-graded).
      const working: BranchGrade[] = branch.map((node, i) => {
        const prev = latest.current[i]
        return prev && prev.fen === node.fen && prev.status === 'done'
          ? prev
          : { fen: node.fen, status: 'pending' as const }
      })
      const commit = () => { setGrades(working.slice()); latest.current = working }
      commit()
      const causes = [...pendingCauses.current]
      pendingCauses.current.clear()

      // Verdicts as promises: the seed's fallback when the browser holds no eval for it.
      const verdicts: Promise<MoveReview | undefined>[] = []
      const gradePly = async (i: number, priority: number): Promise<MoveReview | undefined> => {
        const predFen = i === 0 ? forkFen : branch[i - 1].fen
        let uci: string
        try {
          const move = new Chess(predFen).move(branch[i].san)
          uci = move.from + move.to + (move.promotion ?? '')
        } catch {
          working[i] = { fen: branch[i].fen, status: 'error' }
          commit()
          return undefined
        }

        const attempt = beginAttempt(branch[i].fen)
        const passStart = performance.now()
        const trace: Partial<GradeTrace> = {}
        const record = (outcome: GradeTrace['outcome'], classification?: string) =>
          recordGrade(branch[i].fen, {
            ...trace, ply: i, san: branch[i].san, outcome, classification,
            sinceMoveMs: attempt.sinceMove(), passMs: performance.now() - passStart,
            pass: attempt.pass, causes: attempt.pass > 1 ? causes : [],
          })
        try {
          // Hybrid: attach the browser's own evals when available (backend
          // skips Stockfish), else omit → backend searches.
          const prevFen = i === 0 ? null : i === 1 ? forkFen : branch[i - 2].fen
          const { prevBefore, ...evalPayload } = await frontendEvalPayload(
            predFen, branch[i].fen, prevFen, depth, multipv, reviewEngine, ctrl.signal, trace, priority,
          )
          // Ply 0's seed is the game review's; later plies' the previous position's
          // browser eval, else the previous ply's verdict.
          const seed = i === 0 ? { prevBeforeEval: seedEval }
            : prevBefore ? { prevBefore }
              : { prevBeforeEval: (await verdicts[i - 1])?.evalBefore }
          if (cancelled) { record('aborted'); return undefined }
          const sent = performance.now()
          trace.backend = { path: evalPayload.beforeLines ? 'classify' : 'search', ms: 0 }
          const review = await gradeMove(
            { fenBefore: predFen, uci, whiteElo, blackElo, depth, multipv, ...seed, ...evalPayload },
            ctrl.signal,
          )
          trace.backend.ms = performance.now() - sent
          if (cancelled) { record('aborted'); return undefined }
          working[i] = { fen: branch[i].fen, status: 'done', review }
          record('done', review.classification)
          commit()
          return review
        } catch {
          if (cancelled) { record('aborted'); return undefined }
          if (trace.backend) trace.backend.failed = true
          working[i] = { fen: branch[i].fen, status: 'error' }
          record('error')
          commit()
          return undefined
        }
      }

      const newest = branch.length - 1
      for (let i = 0; i < branch.length; i++) {
        verdicts[i] = working[i].status === 'done'
          ? Promise.resolve(working[i].review)
          : gradePly(i, i === newest ? PRIORITY.gradeNow : PRIORITY.gradeBackfill)
      }
    })

    return () => {
      cancelled = true
      ctrl.abort()
    }
    // branchKey captures branch identity; seedEval/ratings/engine settings
    // re-grade when they change (cheap now: a re-ask rejoins any running search).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled, branchKey, seedEval, whiteElo, blackElo, depth, multipv,
    reviewEngine, forkFen, forkPly,
  ])

  // Show nothing when not exploring; stale state is harmless (reconciled on the
  // next grading pass) but must never render against a game-line board.
  return enabled && branch.length > 0 ? grades : EMPTY_GRADES
}
