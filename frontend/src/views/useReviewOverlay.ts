import { useMemo, useState } from 'react'
import type { MoveReview } from '../api/review'
import { reviewArrows } from '../reviewArrows'
import { reviewBadge } from '../reviewBadge'
import { evalBarFromReview, branchEvalBar, type EvalBarValue } from '../reviewEvalBar'
import type { BranchGrade } from '../hooks/useBranchReview'
import type { BoardOverlay } from './gameShellContext'
import { useBoardOverlay } from './useBoardOverlay'
import { useReviewMap, useCurrentReview } from './reviewDerivations'

const ARROW_BEST = 'var(--review-best)'

// Stable identity for an omitted branchGrades — a `= []` literal in the
// destructuring default below would be a fresh array on every call, which
// would defeat the overlay useMemo's deps (see useBranchReview's own
// EMPTY_GRADES, which is the actual value ReviewPanel passes today).
const EMPTY_BRANCH_GRADES: BranchGrade[] = []

interface Options {
  // Whether the review has finished — gates the game-line eval bar (no bar
  // until done). Does not gate the branch bar while exploring; see below.
  done: boolean
  // Whether the guided walkthrough is showing — gates the best-move arrows and
  // the move badge. The summary screen keeps the eval bar but no arrows/badge.
  walkthrough: boolean
  // Deviating: the board shows the explored branch, not the game line. Its
  // badge is the branch ply's own verdict (from POST /reviews/move), passed in
  // here. Game arrows still don't apply to a branch position, but the eval bar
  // does — sourced from branchGrades/branchIndex below.
  exploring?: boolean
  branchBadge?: BoardOverlay['badge']
  // Per-ply grades for the explored branch (Review only) — the eval bar's
  // source while exploring at branchIndex >= 1.
  branchGrades?: BranchGrade[]
  // Position within the branch: 0 = the fork (a game position — the eval bar
  // falls back to evalBarFromReview), k = after branchGrades[k - 1].
  branchIndex?: number
}

interface Result {
  // ply → classification, for MoveList.
  reviewMap: Map<number, MoveReview['classification']>
  // This ply's review row (or null), for ReviewGuide.
  current: MoveReview | null
}

function eqBar(a: EvalBarValue | null, b: EvalBarValue | null): boolean {
  if (a === b) return true
  return a != null && b != null && a.evaluation === b.evaluation && a.mate === b.mate
}

interface Freeze {
  exploring: boolean
  branchKey: string
  held: EvalBarValue | null
}

// Derives the board overlay (arrows + badge + eval bar) for the Review tab and
// pushes it to the shared board via useBoardOverlay. Returns the two derived
// values the panel still renders directly (the move map and the current row).
export function useReviewOverlay(
  moves: MoveReview[], moveIndex: number,
  {
    done, walkthrough, exploring = false, branchBadge,
    branchGrades = EMPTY_BRANCH_GRADES, branchIndex = 0,
  }: Options,
): Result {
  const reviewMap = useReviewMap(moves)
  const current = useCurrentReview(moves, moveIndex)

  const gameBar = done ? evalBarFromReview(current, moves) : null
  // The eval bar's value before freezing is applied: the game-line bar at the
  // fork (branchIndex 0, exploring or not) and off the branch entirely; the
  // branch ply's own grade once exploring past it.
  const rawBar = exploring && branchIndex >= 1 ? branchEvalBar(branchGrades, branchIndex) : gameBar

  // Freeze for the branch eval bar: grading walks the branch as a front-to-
  // back wavefront, so the current ply's grade is pending (or errored) more
  // often than not. Hold the last shown value instead of flickering the bar to
  // null on every new move; `error` is treated the same as `pending` (hold),
  // not a fallback to null — a bar that vanishes on a transient grading blip
  // is worse than one that lags. Reset to null on the two triggers that make
  // an old number wrong for what's about to show: exploring ending, and the
  // branch's identity changing — a new branch must never inherit the old
  // one's number. Falling back to a *held* value (as opposed to just reading
  // it for reference stability, below) only ever happens for branchIndex >= 1
  // — the fork (branchIndex 0) shows gameBar exactly, or null, unchanged.
  //
  // Implemented as state adjusted during render (React's "store info from
  // previous renders" pattern), the same idiom AnalyzePanel's `lastEval` uses
  // for an identical purpose, rather than the ref the design doc names: this
  // project's `react-hooks/refs` lint forbids reading or writing a ref during
  // render, and the held value has to be read during render to compute the
  // overlay. Value-compared (not reference-compared) before committing, so a
  // same-valued rebuild of rawBar/gameBar doesn't loop the state update.
  // First branch ply identifies a new deviation. Later plies grow as grading
  // advances; including them here would clear the held eval on every append.
  const branchKey = branchGrades[0]?.fen ?? ''
  const [freeze, setFreeze] = useState<Freeze>({ exploring, branchKey, held: null })
  let held = freeze.held
  // '' → key is the first grades of a new deviation, still showing the fork: hold it.
  const replaced = freeze.branchKey !== branchKey && freeze.branchKey !== ''
  if ((freeze.exploring && !exploring) || replaced) held = null
  if (rawBar && !eqBar(rawBar, held)) held = rawBar
  if (freeze.exploring !== exploring || freeze.branchKey !== branchKey || !eqBar(held, freeze.held)) {
    setFreeze({ exploring, branchKey, held })
  }

  // `rawBar` is a fresh object every render (evalBarFromReview/branchEvalBar
  // build a literal each call), so returning it directly here would change
  // `evalBar`'s reference every render even when the number hasn't — which
  // would defeat the overlay useMemo below exactly like the branchGrades
  // identity churn above. `held` was just synced to equal `rawBar` by value
  // (or is unchanged from the previous render), so route every non-null
  // result through it for a stable reference; only fall through to `null`
  // when neither a fresh value nor a frozen one exists (the fork/non-
  // exploring cases never fall back to a stale branch number).
  const showBar = rawBar != null || (exploring && branchIndex >= 1)
  // Held with nothing fresh behind it: the ply is still grading, so the
  // number is the previous node's.
  const stale = showBar && rawBar == null
  const evalBar = useMemo(
    () => (showBar && held ? { ...held, stale } : null),
    [showBar, held, stale],
  )

  const overlay = useMemo<BoardOverlay>(() => {
    // Exploring overrides the game arrows/badge: the board is a branch
    // position. The eval bar does not — branch grading (POST /reviews/move) is
    // independent of the whole-game review, so this path produces a bar
    // regardless of `done`.
    if (exploring) return { arrows: [], badge: branchBadge, evalBar }
    // evalBar is already null here: gameBar (and so rawBar) is gated on done.
    if (!done) return { arrows: [], badge: undefined, evalBar }
    if (!walkthrough) return { arrows: [], badge: undefined, evalBar }
    return {
      arrows: current ? reviewArrows(current, ARROW_BEST) : [],
      badge: current ? reviewBadge(current) : undefined,
      evalBar,
    }
  }, [done, walkthrough, exploring, branchBadge, current, evalBar])
  useBoardOverlay(overlay)

  return { reviewMap, current }
}
