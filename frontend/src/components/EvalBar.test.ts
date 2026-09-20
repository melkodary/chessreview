import { describe, it, expect } from 'vitest'
import { whitePercent } from '../eval'

describe('whitePercent', () => {
  it('returns 50 for neutral eval', () => {
    expect(whitePercent(0, null)).toBe(50)
  })

  it('scales positive eval upward', () => {
    expect(whitePercent(2, null)).toBe(70)
  })

  it('scales negative eval downward', () => {
    expect(whitePercent(-2, null)).toBe(30)
  })

  it('clamps to 100 for large positive', () => {
    expect(whitePercent(100, null)).toBe(100)
  })

  it('clamps to 0 for large negative', () => {
    expect(whitePercent(-100, null)).toBe(0)
  })

  it('returns 100 for positive mate regardless of evaluation', () => {
    expect(whitePercent(0, 3)).toBe(100)
    expect(whitePercent(-99, 1)).toBe(100)
  })

  it('returns 0 for negative mate', () => {
    expect(whitePercent(0, -3)).toBe(0)
    expect(whitePercent(99, -1)).toBe(0)
  })
})
