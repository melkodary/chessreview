import { describe, it, expect } from 'vitest'
import { whitePovWin, yForWin, smoothPath, areaPath } from './evalGraph.geometry'
import type { MoveReview } from '../api/review'

function move(partial: Partial<MoveReview>): MoveReview {
  return {
    ply: 1, san: 'e4', fenBefore: 'x',
    evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: 'e4', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    classification: 'best',
    mateBefore: null, mateAfterPlayed: null,
    ...partial,
  }
}

describe('whitePovWin', () => {
  it('keeps the value on White moves (odd ply)', () => {
    expect(whitePovWin(move({ ply: 1, winAfterPlayed: 70 }))).toBe(70)
    expect(whitePovWin(move({ ply: 3, winAfterPlayed: 12 }))).toBe(12)
  })

  it('flips the value on Black moves (even ply)', () => {
    expect(whitePovWin(move({ ply: 2, winAfterPlayed: 70 }))).toBe(30)
    expect(whitePovWin(move({ ply: 4, winAfterPlayed: 10 }))).toBe(90)
  })

  it('flattens book moves to 50 regardless of side', () => {
    expect(whitePovWin(move({ ply: 2, winAfterPlayed: 80, classification: 'book' }))).toBe(50)
    expect(whitePovWin(move({ ply: 1, winAfterPlayed: 80, classification: 'book' }))).toBe(50)
  })
})

describe('yForWin', () => {
  it('maps 100 to the top and 0 to the bottom', () => {
    expect(yForWin(100, 30)).toBe(0)
    expect(yForWin(0, 30)).toBe(30)
    expect(yForWin(50, 30)).toBe(15)
  })

  it('clamps out-of-range win values into the viewport', () => {
    expect(yForWin(150, 30)).toBe(0)
    expect(yForWin(-50, 30)).toBe(30)
  })
})

describe('smoothPath', () => {
  it('returns empty string for no points', () => {
    expect(smoothPath([])).toBe('')
  })

  it('returns a lone move command for a single point', () => {
    expect(smoothPath([{ x: 5, y: 10 }])).toBe('M 5,10')
  })

  it('starts with a move then cubic curves for multiple points', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 5 }])
    expect(d.startsWith('M 0,0')).toBe(true)
    expect(d).toContain('C')
  })
})

describe('areaPath', () => {
  it('returns empty string for no points', () => {
    expect(areaPath([], 30)).toBe('')
  })

  it('closes the curve down to the baseline height', () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 20, y: 5 }], 30)
    expect(d.startsWith('M 0,10')).toBe(true)
    expect(d).toContain('L 20,30') // drop to baseline at last x
    expect(d).toContain('L 0,30') // back along baseline to first x
    expect(d.endsWith('Z')).toBe(true)
  })
})
