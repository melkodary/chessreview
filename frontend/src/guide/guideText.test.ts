import { describe, it, expect } from 'vitest'
import type { Classification, MoveReview } from '../api/review'
import { heuristicGuide } from './guideText'

function move(partial: Partial<MoveReview> & { classification: Classification }): MoveReview {
  return {
    ply: 1,
    san: 'e4',
    fenBefore: '',
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

describe('heuristicGuide.describe', () => {
  it('book move stays in book', () => {
    expect(heuristicGuide.describe(move({ san: 'e4', classification: 'book' })))
      .toBe('e4 — still in book')
  })

  it('played move that is best', () => {
    expect(heuristicGuide.describe(move({ san: 'Nf3', bestMoveSan: 'Nf3', classification: 'best' })))
      .toBe('Nf3 is the best move')
  })

  it('brilliant move keeps its label even when it is the best', () => {
    expect(heuristicGuide.describe(move({ san: 'Qxh7', bestMoveSan: 'Qxh7', classification: 'brilliant' })))
      .toBe('Qxh7 is a brilliant move')
  })

  it('critical move keeps its label', () => {
    expect(heuristicGuide.describe(move({ san: 'Rxh4', bestMoveSan: 'Rxh4', classification: 'great' })))
      .toBe('Rxh4 is a critical move')
  })

  it('blunder names the best move with correct article', () => {
    expect(heuristicGuide.describe(move({ san: 'e6', bestMoveSan: 'dxe6', classification: 'blunder' })))
      .toBe('e6 is a blunder — best was dxe6')
  })

  it('inaccuracy uses "an"', () => {
    expect(heuristicGuide.describe(move({ san: 'h4', bestMoveSan: 'Rxh4', classification: 'inaccuracy' })))
      .toBe('h4 is an inaccuracy — best was Rxh4')
  })

  it('good move does not name the best move', () => {
    expect(heuristicGuide.describe(move({ san: 'a5', bestMoveSan: 'd5', classification: 'good' })))
      .toBe('a5 is a good move')
  })

  it('excellent reads as Solid', () => {
    expect(heuristicGuide.describe(move({ san: 'a5', bestMoveSan: 'd5', classification: 'excellent' })))
      .toBe('a5 is a solid move')
  })

  it('miss names the best move', () => {
    expect(heuristicGuide.describe(move({ san: 'g6', bestMoveSan: 'Nxg5', classification: 'miss' })))
      .toBe('g6 is a missed chance — best was Nxg5')
  })
})
