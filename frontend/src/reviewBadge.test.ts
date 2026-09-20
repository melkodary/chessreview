import { describe, it, expect } from 'vitest'
import type { Classification, MoveReview } from './api/review'
import { reviewBadge } from './reviewBadge'

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

describe('reviewBadge', () => {
  it('returns undefined for a null move', () => {
    expect(reviewBadge(null)).toBeUndefined()
  })

  it('gives the destination square for a normal move', () => {
    const badge = reviewBadge(move({ san: 'e4', classification: 'best' }))
    expect(badge).toEqual({ square: 'e4', classification: 'best' })
  })

  it('gives the destination square for a capture', () => {
    const fenBefore = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    const badge = reviewBadge(move({ san: 'exd5', fenBefore, classification: 'good' }))
    expect(badge).toEqual({ square: 'd5', classification: 'good' })
  })

  it('gives the destination square for a promotion', () => {
    const fenBefore = '8/P6k/8/8/8/8/7K/8 w - - 0 1'
    const badge = reviewBadge(move({ san: 'a8=Q', fenBefore, classification: 'brilliant' }))
    expect(badge).toEqual({ square: 'a8', classification: 'brilliant' })
  })

  it('gives the king square for castling', () => {
    const fenBefore = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'
    const badge = reviewBadge(move({ san: 'O-O', fenBefore, classification: 'excellent' }))
    expect(badge).toEqual({ square: 'g1', classification: 'excellent' })
  })

  it('returns undefined for an unparseable move, without throwing', () => {
    expect(() => reviewBadge(move({ san: 'Zz9', classification: 'blunder' }))).not.toThrow()
    expect(reviewBadge(move({ san: 'Zz9', classification: 'blunder' }))).toBeUndefined()
  })
})
