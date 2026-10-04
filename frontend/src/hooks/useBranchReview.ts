import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { ExploreNode } from './useBoardExploration'
import type { MoveReview } from '../api/review'
import { gradeMove, type GradeLine, type GradeMoveEval } from '../api/analyzer'
import { ensureEval, PRIORITY } from '../engine/ensureEval'
import { beginAttempt, noteNeeded, recordGrade, type GradeTrace } from '../engine/gradeTrace'
import { beforeLinesFrom, isTerminalFen, scoreOf } from '../engine/reviewPayload'
import { GRADE_MAX_ATTEMPTS } from '../config'

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
  enabled: boolean // only grade on the Review tab while exploring
}

// Stable identity for "not exploring" (mirrors useBoardExploration's EMPTY
// sentinel): a fresh `[]` literal on every idle render would change reference
// on every render, defeating any consumer's useMemo/useEffect deps built on
// this array (useReviewOverlay's eval-bar memo among them).
const EMPTY_GRADES: BranchGrade[] = []

interface EvalPayload { beforeLines?: GradeLine[]; afterEval?: GradeMoveEval; prevBefore?: GradeMoveEval }

// One ply's browser evals; a terminal after-position needs no after-eval (the backend
// synthesizes it). `prevFen`'s rank-1 score is the ply's seed.
async function frontendEvalPayload(
  predFen: string, afterFen: string, prevFen: string | null, depth: number, multipv: number,
  signal: AbortSignal, trace: Partial<GradeTrace>, priority: number,
): Promise<EvalPayload> {
  const terminal = isTerminalFen(afterFen)
  const [before, after, prev] = await Promise.all([
    ensureEval(predFen, depth, multipv, signal, { priority, onOutcome: (o) => { trace.before = o } }),
    terminal ? null : ensureEval(afterFen, depth, multipv, signal, { priority, onOutcome: (o) => { trace.after = o } }),
    prevFen ? ensureEval(prevFen, depth, multipv, signal, { priority }) : null,
  ])
  if (terminal) trace.after = 'terminal'
  const prevBefore = prev?.lines[0] ? scoreOf(prev.lines[0]) : undefined
  // A forced move has one line to send; the backend grades it from that alone.
  const forced = new Chess(predFen).moves().length === 1
  const beforeLines = before ? beforeLinesFrom(before, forced ? 1 : 2) : null
  if (!beforeLines) return { prevBefore }
  if (terminal) return { beforeLines, prevBefore }
  if (!after?.lines[0]) return { prevBefore }
  return { beforeLines, afterEval: scoreOf(after.lines[0]), prevBefore }
}

// The browser is the only eval source (2026-10-04): a failed search is asked again,
// up to GRADE_MAX_ATTEMPTS, never handed to the backend's own engine.
async function browserEvals(
  ...args: Parameters<typeof frontendEvalPayload>
): Promise<EvalPayload & { beforeLines: GradeLine[] }> {
  const [, afterFen, prevFen, , , signal] = args
  for (let attempt = 1; ; attempt++) {
    const p = await frontendEvalPayload(...args)
    const complete = p.beforeLines && (p.afterEval || isTerminalFen(afterFen)) && (!prevFen || p.prevBefore)
    if (complete) return { ...p, beforeLines: p.beforeLines! }
    if (signal.aborted || attempt >= GRADE_MAX_ATTEMPTS) throw new Error('no browser eval')
  }
}

// Grades an exploration branch through the backend classifier (POST /reviews/move).
// Plies are independent given evals: the newest ply's positions are searched first,
// older ones backfill, and a branch edit's re-ask rejoins searches still running.
export function useBranchReview({
  branch, forkFen, forkPly, gameMoves, whiteElo, blackElo, depth, multipv,
  enabled,
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
      enabled, branch: branchKey, seedEval, whiteElo, blackElo, depth, multipv, forkFen, forkPly,
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

      const gradePly = async (i: number, priority: number): Promise<void> => {
        const predFen = i === 0 ? forkFen : branch[i - 1].fen
        let uci: string
        try {
          const move = new Chess(predFen).move(branch[i].san)
          uci = move.from + move.to + (move.promotion ?? '')
        } catch {
          working[i] = { fen: branch[i].fen, status: 'error' }
          commit()
          return
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
          const prevFen = i === 0 ? null : i === 1 ? forkFen : branch[i - 2].fen
          const { prevBefore, ...evalPayload } = await browserEvals(
            predFen, branch[i].fen, prevFen, depth, multipv, ctrl.signal, trace, priority,
          )
          // Ply 0's seed is the game review's; later plies' the previous position's eval.
          const seed = i === 0 ? { prevBeforeEval: seedEval } : { prevBefore }
          if (cancelled) { record('aborted'); return }
          const sent = performance.now()
          trace.backend = { ms: 0 }
          const review = await gradeMove(
            { fenBefore: predFen, uci, whiteElo, blackElo, depth, multipv, ...seed, ...evalPayload },
            ctrl.signal,
          )
          trace.backend.ms = performance.now() - sent
          if (cancelled) { record('aborted'); return }
          working[i] = { fen: branch[i].fen, status: 'done', review }
          record('done', review.classification)
          commit()
        } catch {
          if (cancelled) { record('aborted'); return }
          if (trace.backend) trace.backend.failed = true
          working[i] = { fen: branch[i].fen, status: 'error' }
          record('error')
          commit()
        }
      }

      const newest = branch.length - 1
      for (let i = 0; i < branch.length; i++) {
        if (working[i].status !== 'done') void gradePly(i, i === newest ? PRIORITY.gradeNow : PRIORITY.gradeBackfill)
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
    enabled, branchKey, seedEval, whiteElo, blackElo, depth, multipv, forkFen, forkPly,
  ])

  // Show nothing when not exploring; stale state is harmless (reconciled on the
  // next grading pass) but must never render against a game-line board.
  return enabled && branch.length > 0 ? grades : EMPTY_GRADES
}
