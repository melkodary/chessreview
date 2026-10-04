import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Classification, MoveReview } from '../api/review'
import type { BranchGrade } from '../hooks/useBranchReview'
import type { BoardOverlay } from './gameShellContext'
import { useReviewOverlay } from './useReviewOverlay'

// The overlay is pushed via useBoardOverlay → useGameShell's outlet context,
// which isn't available outside a real router tree. Stub it and capture what
// each render pushes, the same pattern AnalyzePanel.test.tsx uses.
let lastOverlay: BoardOverlay | undefined
vi.mock('./useBoardOverlay', () => ({
  useBoardOverlay: (o: BoardOverlay) => { lastOverlay = o },
}))

function move(over: Partial<MoveReview> & { ply: number }): MoveReview {
  return {
    san: 'e4', fenBefore: 'f', evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: 'e4', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    classification: 'best' as Classification, mateBefore: null, mateAfterPlayed: null,
    ...over,
  }
}

function grade(over: Partial<BranchGrade> = {}): BranchGrade {
  return { fen: 'f', status: 'done', ...over }
}

interface Props {
  moves: MoveReview[]
  moveIndex: number
  done: boolean
  exploring: boolean
  branchGrades: BranchGrade[]
  branchIndex: number
}

function setup(props: Props) {
  return renderHook(
    (p: Props) => useReviewOverlay(p.moves, p.moveIndex, {
      done: p.done, walkthrough: false, exploring: p.exploring,
      branchGrades: p.branchGrades, branchIndex: p.branchIndex,
    }),
    { initialProps: props },
  )
}

const base: Props = {
  moves: [], moveIndex: 0, done: false, exploring: true, branchGrades: [], branchIndex: 1,
}

describe('useReviewOverlay branch eval bar', () => {
  beforeEach(() => { lastOverlay = undefined })

  it('branchIndex 0 falls back to the game-line bar', () => {
    const moves = [move({ ply: 1, evalAfterPlayed: 0.42 })]
    setup({ ...base, moves, moveIndex: 1, done: true, branchIndex: 0, branchGrades: [] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 0.42, mate: null, stale: false })
  })

  it('branchIndex 0 stays null when the whole-game review is not done (unchanged)', () => {
    setup({ ...base, branchIndex: 0, branchGrades: [] })
    expect(lastOverlay?.evalBar).toBeNull()
  })

  it('a done branch grade shows its own eval regardless of `done`', () => {
    const g = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: -1.1 }) })
    setup({ ...base, done: false, branchIndex: 1, branchGrades: [g] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: -1.1, mate: null, stale: false })
  })

  it('holds the last shown value across a done → pending → done sequence', () => {
    const done1 = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: 1.2 }) })
    const { rerender } = setup({ ...base, branchIndex: 1, branchGrades: [done1] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: false })

    // Same fen (same branch identity), status regresses to pending: held.
    const pending = grade({ fen: 'p1', status: 'pending' })
    rerender({ ...base, branchIndex: 1, branchGrades: [pending] })
    // Held, not fresh: the number is the previous node's, so it renders dimmed.
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: true })

    // Error is treated the same as pending: still held.
    const errored = grade({ fen: 'p1', status: 'error' })
    rerender({ ...base, branchIndex: 1, branchGrades: [errored] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: true })

    // Resolves to a new value: freeze releases.
    const done2 = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: 3.4 }) })
    rerender({ ...base, branchIndex: 1, branchGrades: [done2] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 3.4, mate: null, stale: false })
  })

  it('holds the prior ply while an appended branch ply is pending', () => {
    const done1 = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: 1.2 }) })
    const { rerender } = setup({ ...base, branchIndex: 1, branchGrades: [done1] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: false })

    const pending2 = grade({ fen: 'p2', status: 'pending' })
    rerender({ ...base, branchIndex: 2, branchGrades: [done1, pending2] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: true })
  })

  it('first branch ply pending with nothing held yet → null', () => {
    const pending = grade({ fen: 'p1', status: 'pending' })
    setup({ ...base, branchIndex: 1, branchGrades: [pending] })
    expect(lastOverlay?.evalBar).toBeNull()
  })

  it('clears the freeze when exploring goes false', () => {
    const done1 = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: 1.2 }) })
    const { rerender } = setup({ ...base, branchIndex: 1, branchGrades: [done1] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: false })

    // Reset to the game: exploring off, review still not done.
    rerender({ ...base, exploring: false, done: false, branchIndex: 0, branchGrades: [] })
    expect(lastOverlay?.evalBar).toBeNull()

    // Explore again: a fresh pending ply must not inherit the old number.
    const pendingAgain = grade({ fen: 'p2', status: 'pending' })
    rerender({ ...base, exploring: true, branchIndex: 1, branchGrades: [pendingAgain] })
    expect(lastOverlay?.evalBar).toBeNull()
  })

  it('clears the freeze when branch identity changes', () => {
    const done1 = grade({ fen: 'p1', review: move({ ply: 1, evalAfterPlayed: 1.2 }) })
    const { rerender } = setup({ ...base, branchIndex: 1, branchGrades: [done1] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 1.2, mate: null, stale: false })

    // A different branch (new fen at the same index) is pending: no inherited number.
    const differentBranch = grade({ fen: 'p2', status: 'pending' })
    rerender({ ...base, branchIndex: 1, branchGrades: [differentBranch] })
    expect(lastOverlay?.evalBar).toBeNull()
  })

  it("holds the fork's game-line value while a new deviation's first ply grades", () => {
    const moves = [move({ ply: 1, evalAfterPlayed: 0.3 })]
    const { rerender } = setup({
      ...base, moves, moveIndex: 1, done: true, exploring: true, branchIndex: 0, branchGrades: [],
    })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 0.3, mate: null, stale: false })

    // The first grades arrive (pending): no earlier branch to protect, so the fork's value holds.
    const pending = grade({ fen: 'p1', status: 'pending' })
    rerender({ ...base, moves, moveIndex: 1, done: true, branchIndex: 1, branchGrades: [pending] })
    expect(lastOverlay?.evalBar).toEqual({ evaluation: 0.3, mate: null, stale: true })
  })
})

