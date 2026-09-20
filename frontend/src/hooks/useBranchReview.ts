import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { ExploreNode } from './useBoardExploration'
import type { MoveReview } from '../api/review'
import { gradeMove, type GradeLine, type GradeMoveEval } from '../api/analyzer'
import { ensureEval } from '../engine/ensureEval'
import { beforeLinesFrom, isTerminalFen, scoreOf } from '../engine/reviewPayload'
import { BRANCH_GRADE_DEBOUNCE_MS, GRADE_WITH_FRONTEND_ENGINE } from '../config'
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

// Assemble the frontend-eval payload for one ply, or {} to let the backend
// search. Reuses the browser's own eval-bar work (ensureEval), driving a WASM
// search only on a cache miss; a terminal after-position needs no after-eval
// (the backend synthesizes it). Flag off, engine unavailable, or too few lines
// all resolve to an empty payload → backend engine (guaranteed parity).
async function frontendEvalPayload(
  predFen: string, afterFen: string, depth: number, multipv: number,
  reviewEngine: string | null, signal: AbortSignal,
): Promise<{ beforeLines?: GradeLine[]; afterEval?: GradeMoveEval }> {
  // Same major version either side, so a branch grade may mix nets (2026-07-16).
  const sameVersion = reviewEngine === REVIEW_ENGINE_NAME || reviewEngine === WASM_ENGINE_NAME
  if (!GRADE_WITH_FRONTEND_ENGINE || !sameVersion) return {}
  const before = await ensureEval(predFen, depth, multipv, signal)
  const beforeLines = before ? beforeLinesFrom(before) : null
  if (!beforeLines) return {}
  if (isTerminalFen(afterFen)) return { beforeLines }
  const after = await ensureEval(afterFen, depth, multipv, signal)
  if (!after || !after.lines[0]) return {}
  return { beforeLines, afterEval: scoreOf(after.lines[0]) }
}

// Grades an exploration branch ply-by-ply through the backend classifier
// (POST /reviews/move), the same rules a whole-game review uses. Sequential by
// design: ply i's `prev_before_eval` seed is ply i−1's before-eval, so grading
// walks the branch front-to-back, a wavefront of pending → done. Debounced so
// blitzing moves doesn't fire the engine on every half-built position; a branch
// edit aborts the in-flight grade (latest-wins) and preserves already-graded
// nodes whose FEN still matches.
export function useBranchReview({
  branch, forkFen, forkPly, gameMoves, whiteElo, blackElo, depth, multipv,
  reviewEngine, enabled,
}: Params): BranchGrade[] {
  const [grades, setGrades] = useState<BranchGrade[]>([])
  // Mirror of the committed grades, read at the start of a grading pass to
  // carry forward verdicts that survived a branch edit.
  const latest = useRef<BranchGrade[]>([])
  useEffect(() => { latest.current = grades }, [grades])

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
    if (!enabled || branch.length === 0) return
    const ctrl = new AbortController()
    let cancelled = false

    const timer = setTimeout(async () => {
      // Reconcile: keep done verdicts whose node still matches by FEN, else
      // reset to pending (a diverged position must be re-graded).
      const working: BranchGrade[] = branch.map((node, i) => {
        const prev = latest.current[i]
        return prev && prev.fen === node.fen && prev.status === 'done'
          ? prev
          : { fen: node.fen, status: 'pending' as const }
      })
      setGrades(working.slice())
      latest.current = working

      for (let i = 0; i < branch.length; i++) {
        if (cancelled) return
        if (working[i].status === 'done') continue

        const predFen = i === 0 ? forkFen : branch[i - 1].fen
        const prevBeforeEval = i === 0 ? seedEval : working[i - 1].review?.evalBefore

        let uci: string
        try {
          const move = new Chess(predFen).move(branch[i].san)
          uci = move.from + move.to + (move.promotion ?? '')
        } catch {
          working[i] = { fen: branch[i].fen, status: 'error' }
          setGrades(working.slice())
          continue
        }

        try {
          // Hybrid: attach the browser's own evals when available (backend
          // skips Stockfish), else omit → backend searches. A superseding edit
          // aborts mid-search (latest-wins); bail before committing a verdict.
          const evalPayload = await frontendEvalPayload(
            predFen, branch[i].fen, depth, multipv, reviewEngine, ctrl.signal,
          )
          if (cancelled) return
          const review = await gradeMove(
            { fenBefore: predFen, uci, whiteElo, blackElo, depth, multipv, prevBeforeEval, ...evalPayload },
            ctrl.signal,
          )
          if (cancelled) return
          working[i] = { fen: branch[i].fen, status: 'done', review }
        } catch {
          if (cancelled) return
          working[i] = { fen: branch[i].fen, status: 'error' }
        }
        setGrades(working.slice())
        latest.current = working
      }
    }, BRANCH_GRADE_DEBOUNCE_MS)

    return () => {
      cancelled = true
      ctrl.abort()
      clearTimeout(timer)
    }
    // branchKey captures branch identity; seedEval/ratings/engine settings
    // re-grade when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled, branchKey, seedEval, whiteElo, blackElo, depth, multipv,
    reviewEngine, forkFen, forkPly,
  ])

  // Show nothing when not exploring; stale state is harmless (reconciled on the
  // next grading pass) but must never render against a game-line board.
  return enabled && branch.length > 0 ? grades : EMPTY_GRADES
}
