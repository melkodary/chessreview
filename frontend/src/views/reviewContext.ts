import { createContext, useContext } from 'react'
import type { useGameReview } from '../hooks/useGameReview'
import type { BranchGrade } from '../hooks/useBranchReview'
import type { ProvisionalPoint } from '../api/review'

type ReviewResult = ReturnType<typeof useGameReview>

interface ReviewContextValue extends ReviewResult {
  // Lifted out of ReviewPanel so it survives the tab-switch unmount/remount
  // (ReviewProvider sits above the Outlet in GameShell).
  reviewView: 'summary' | 'walkthrough'
  setReviewView: (view: 'summary' | 'walkthrough') => void
  // Graded by the provider, not the panel, so verdicts outlive a tab flip.
  branchGrades: BranchGrade[]
  // Browser-swept eval estimates for the plies the running review hasn't
  // reached. Empty when the flag is off. Never a badge source — the type
  // carries no classification.
  provisional: ProvisionalPoint[]
}

export const ReviewContext = createContext<ReviewContextValue | null>(null)

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext)
  if (!ctx) throw new Error('useReview must be inside ReviewProvider')
  return ctx
}
