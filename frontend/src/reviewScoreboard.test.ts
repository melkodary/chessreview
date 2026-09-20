import { describe, it, expect } from 'vitest'
import { partialSummary } from './reviewScoreboard'
import type { MoveReview } from './api/review'

const BASE: Omit<MoveReview, 'ply' | 'classification'> = {
  san: 'e4', fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  evalBefore: 0, evalAfterPlayed: 0, bestMoveSan: 'e4',
  winBefore: 50, winAfterPlayed: 50, winDrop: 0,
  mateBefore: null, mateAfterPlayed: null,
}

function mv(ply: number, classification: MoveReview['classification']): MoveReview {
  return { ...BASE, ply, classification }
}

describe('partialSummary', () => {
  it('returns null accuracy and empty counts for no moves', () => {
    const s = partialSummary([])
    expect(s.white.accuracy).toBeNull()
    expect(s.black.accuracy).toBeNull()
    expect(s.white.counts).toEqual({})
    expect(s.black.counts).toEqual({})
  })

  it('buckets odd plies to white, even to black', () => {
    const s = partialSummary([mv(1, 'best'), mv(2, 'blunder'), mv(3, 'mistake')])
    expect(s.white.counts).toEqual({ best: 1, mistake: 1 })
    expect(s.black.counts).toEqual({ blunder: 1 })
  })

  it('accumulates repeated classifications', () => {
    const s = partialSummary([mv(1, 'best'), mv(3, 'best'), mv(5, 'best')])
    expect(s.white.counts.best).toBe(3)
  })

  it('leaves keyMoments empty and accuracy null', () => {
    const s = partialSummary([mv(1, 'brilliant')])
    expect(s.keyMoments).toEqual([])
    expect(s.white.accuracy).toBeNull()
    expect(s.black.accuracy).toBeNull()
    expect(s.white.biggestBlunderPly).toBeNull()
  })
})
