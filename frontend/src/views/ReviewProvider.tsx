import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ReviewMeta } from '../api/analyzer'
import type { ExploreNode } from '../hooks/useBoardExploration'
import { useGameReview } from '../hooks/useGameReview'
import { useBranchReview } from '../hooks/useBranchReview'
import { useSpeculation } from '../hooks/useSpeculation'
import { useProvisionalCurve } from '../hooks/useProvisionalCurve'
import type { PositionStep } from '../hooks/useGameViewer'
import { useSettings } from '../settingsContext'
import { SPECULATE } from '../config'
import { ReviewContext } from './reviewContext'

interface Props {
  pgn: string
  meta?: ReviewMeta
  // Branch grading inputs — from GameShell, not the route-scoped panel below.
  branch: ExploreNode[]
  forkFen: string
  forkPly: number
  gradingEnabled: boolean
  // Provisional-sweep inputs, from GameShell for the same reason.
  positions?: PositionStep[]
  sweepEnabled?: boolean
  children: ReactNode
}

const NO_POSITIONS: PositionStep[] = []

export function ReviewProvider({
  pgn, meta, branch, forkFen, forkPly, gradingEnabled,
  positions = NO_POSITIONS, sweepEnabled = false, children,
}: Props) {
  const review = useGameReview(pgn, meta, positions)
  const { reviewDepth, reviewMultiPv, provisionalCurve } = useSettings()

  // Lifted from ReviewPanel so it survives the tab-switch unmount/remount.
  // Review request state lives in the hook; this view state is all the provider
  // still owns.
  const [reviewView, setReviewView] = useState<'summary' | 'walkthrough'>('summary')

  // Lifted for the same reason: the branch already lives above the Outlet, so
  // grading it in the panel left verdicts below the remount boundary — a tab
  // flip re-ran the engine over a branch that had survived.
  const branchGrades = useBranchReview({
    branch, forkFen, forkPly, gameMoves: review.moves,
    whiteElo: meta?.whiteElo, blackElo: meta?.blackElo,
    depth: reviewDepth, multipv: reviewMultiPv,
    enabled: gradingEnabled,
  })

  // Review tab only (grading is Review-only): the game position, or the branch tip.
  useSpeculation({
    fen: branch.at(-1)?.fen ?? forkFen, depth: reviewDepth, multipv: reviewMultiPv,
    enabled: SPECULATE && (gradingEnabled || sweepEnabled),
  })

  // Lifted for the third time for the same reason, plus one of its own: the
  // sweep is the only WASM consumer nobody waits on, so it must hold the engine
  // only while no other one wants it. `sweepEnabled` is that arbitration
  // (Review tab, not exploring); the effect's cleanup aborts before the
  // preempting consumer's own effect runs, and the eval cache makes the resume
  // free.
  // Pass 2 of a frontend-sourced review rides the same effect, after pass 1,
  // under the same arbitration — see the hook.
  const provisional = useProvisionalCurve({
    positions,
    whiteElo: meta?.whiteElo,
    blackElo: meta?.blackElo,
    enabled: provisionalCurve && sweepEnabled && review.state === 'running',
    deep: review.sweep && {
      ...review.sweep,
      enabled: sweepEnabled,
      onProgress: review.reportSweep,
      onDone: review.submitSweep,
    },
  })

  // Snap back to the summary screen when the game actually changes (StrictMode-
  // safe: a remount with the same pgn is a no-op).
  const prevPgn = useRef(pgn)
  useEffect(() => {
    if (prevPgn.current === pgn) return
    prevPgn.current = pgn
    setReviewView('summary')
  }, [pgn])

  return (
    <ReviewContext.Provider value={{ ...review, reviewView, setReviewView, branchGrades, provisional }}>
      {children}
    </ReviewContext.Provider>
  )
}
