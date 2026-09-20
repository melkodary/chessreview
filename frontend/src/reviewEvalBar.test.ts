import { describe, it, expect } from 'vitest'
import type { Classification, MoveReview } from './api/review'
import type { BranchGrade } from './hooks/useBranchReview'
import { evalBarFromReview, branchEvalBar } from './reviewEvalBar'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function move(
  ply: number,
  evalBefore: number,
  evalAfterPlayed: number,
  mateBefore: number | null = null,
  mateAfterPlayed: number | null = null,
): MoveReview {
  return {
    ply,
    san: 'e4',
    fenBefore: START,
    evalBefore,
    evalAfterPlayed,
    bestMoveSan: 'e4',
    winBefore: 50,
    winAfterPlayed: 50,
    winDrop: 0,
    classification: 'best' as Classification,
    mateBefore,
    mateAfterPlayed,
  }
}

describe('evalBarFromReview', () => {
  it('current move → evalAfterPlayed', () => {
    const m = move(1, 0.2, -3.96)
    expect(evalBarFromReview(m, [m])).toEqual({ evaluation: -3.96, mate: null })
  })

  it('null current with moves → first move evalBefore', () => {
    const m = move(1, 0.2, -3.96)
    expect(evalBarFromReview(null, [m])).toEqual({ evaluation: 0.2, mate: null })
  })

  it('null current + empty moves → null', () => {
    expect(evalBarFromReview(null, [])).toBeNull()
  })

  it('current move → mateAfterPlayed', () => {
    const m = move(1, 0.2, -99.99, null, 3)
    expect(evalBarFromReview(m, [m])).toEqual({ evaluation: -99.99, mate: 3 })
  })

  it('null current with moves → first move mateBefore', () => {
    const m = move(1, -99.99, -3.96, -4, null)
    expect(evalBarFromReview(null, [m])).toEqual({ evaluation: -99.99, mate: -4 })
  })
})

function grade(over: Partial<BranchGrade> = {}): BranchGrade {
  return { fen: 'f', status: 'done', ...over }
}

describe('branchEvalBar', () => {
  it('done grade → its evalAfterPlayed/mateAfterPlayed', () => {
    const g = grade({ review: move(1, 0.2, -3.96) })
    expect(branchEvalBar([g], 1)).toEqual({ evaluation: -3.96, mate: null })
  })

  it('pending grade → null', () => {
    const g = grade({ status: 'pending', review: undefined })
    expect(branchEvalBar([g], 1)).toBeNull()
  })

  it('error grade → null', () => {
    const g = grade({ status: 'error', review: undefined })
    expect(branchEvalBar([g], 1)).toBeNull()
  })

  it('out-of-range branchIndex → null', () => {
    const g = grade({ review: move(1, 0.2, -3.96) })
    expect(branchEvalBar([g], 5)).toBeNull()
  })

  it('branchIndex 0 → null (the fork; caller falls back to evalBarFromReview)', () => {
    const g = grade({ review: move(1, 0.2, -3.96) })
    expect(branchEvalBar([g], 0)).toBeNull()
  })

  it('mate grade carries mate through, not just the ±99.99 sentinel', () => {
    const g = grade({ review: move(1, 0.2, -99.99, null, 4) })
    expect(branchEvalBar([g], 1)).toEqual({ evaluation: -99.99, mate: 4 })
  })
})
