import { describe, it, expect } from 'vitest'
import type { Classification, MoveReview } from './api/review'
import { reviewArrows } from './reviewArrows'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function move(partial: Partial<MoveReview> & { classification: Classification }): MoveReview {
  return {
    ply: 1,
    san: 'e4',
    fenBefore: START,
    evalBefore: 0,
    evalAfterPlayed: 0,
    bestMoveSan: 'e4',
    winBefore: 50,
    winAfterPlayed: 50,
    winDrop: 0,
    mateBefore: null,
    mateAfterPlayed: null,
    ...partial,
  }
}

const BEST = 'green'

describe('reviewArrows', () => {
  it('draws only the best-move arrow (not the played move)', () => {
    const arrows = reviewArrows(move({ san: 'e4', bestMoveSan: 'd4', classification: 'blunder' }), BEST)
    expect(arrows).toEqual([{ startSquare: 'd2', endSquare: 'd4', color: BEST }])
  })

  it('draws the best-move arrow when the played move is best', () => {
    const arrows = reviewArrows(move({ san: 'e4', bestMoveSan: 'e4', classification: 'best' }), BEST)
    expect(arrows).toEqual([{ startSquare: 'e2', endSquare: 'e4', color: BEST }])
  })

  it('returns empty when the best move is illegal/stale', () => {
    const arrows = reviewArrows(move({ san: 'e4', bestMoveSan: 'Zz9', classification: 'blunder' }), BEST)
    expect(arrows).toEqual([])
  })
})
