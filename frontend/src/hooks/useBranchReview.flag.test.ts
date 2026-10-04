import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Chess } from 'chess.js'

// Flag OFF: the grader must never touch the browser engine and always omit the
// eval payload, so the backend searches (guaranteed Phase-1 parity).
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  GRADE_WITH_FRONTEND_ENGINE: false,
}))
vi.mock('../engine/ensureEval', async (orig) => ({
  ...(await orig<typeof import('../engine/ensureEval')>()), ensureEval: vi.fn(),
}))
vi.mock('../api/analyzer', () => ({ gradeMove: vi.fn() }))

import { useBranchReview } from './useBranchReview'
import { gradeMove } from '../api/analyzer'
import { ensureEval } from '../engine/ensureEval'
import type { MoveReview } from '../api/review'

const mockGrade = vi.mocked(gradeMove)
const mockEnsure = vi.mocked(ensureEval)
const START = new Chess().fen()

function node(...sans: string[]) {
  const c = new Chess()
  return sans.map((s) => { c.move(s); return { fen: c.fen(), san: s } })
}
function review(over: Partial<MoveReview>): MoveReview {
  return {
    ply: 0, san: '', fenBefore: '', evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: '', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    classification: 'best', mateBefore: null, mateAfterPlayed: null, ...over,
  }
}

describe('useBranchReview — GRADE_WITH_FRONTEND_ENGINE off', () => {
  beforeEach(() => { vi.useFakeTimers(); mockGrade.mockReset(); mockEnsure.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('never calls the browser engine and always omits the payload', async () => {
    mockGrade.mockResolvedValue(review({}))
    renderHook(() => useBranchReview({
      branch: node('e4'), forkFen: START, forkPly: 0, gameMoves: [],
      depth: 18, multipv: 3, reviewEngine: 'Stockfish 19', enabled: true,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockEnsure).not.toHaveBeenCalled()
    const arg = mockGrade.mock.calls[0][0]
    expect(arg.beforeLines).toBeUndefined()
    expect(arg.afterEval).toBeUndefined()
  })
})
