import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { carryLines, mateAfterPly } from './pvCarry'
import type { AnalysisLine } from '../api/analyzer'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** FEN reached by replaying SAN from `fen` — the ground truth carryLines matches against. */
function after(fen: string, ...san: string[]): string {
  const chess = new Chess(fen)
  for (const s of san) chess.move(s)
  return chess.fen()
}

const line = (moves: string[], overrides: Partial<AnalysisLine> = {}): AnalysisLine => ({
  moves,
  evaluation: 0.3,
  mate: null,
  ...overrides,
})

describe('mateAfterPly', () => {
  // The worked table from the design spec: before / mate / plies / plies' / after / mate'.
  it.each([
    { before: 'white', mate: 5, expected: 4 },
    { before: 'black', mate: 3, expected: 3 },
    { before: 'white', mate: -2, expected: -2 },
    { before: 'black', mate: -2, expected: -1 },
  ])('$before to move, M$mate → M$expected', ({ before, mate, expected }) => {
    expect(mateAfterPly(mate, before === 'white')).toBe(expected)
  })

  it('returns null when the ply being played is the mate itself', () => {
    // White to move, M1: one ply remains, and it is the move being played.
    expect(mateAfterPly(1, true)).toBeNull()
    // Black to move, -M1: same, mirrored.
    expect(mateAfterPly(-1, false)).toBeNull()
  })
})

describe('carryLines position match', () => {
  it('carries the tail when the top line\'s first move is played', () => {
    const next = after(START, 'e4')
    const got = carryLines(START, [line(['e4', 'e5', 'Nf3']), line(['d4', 'd5'])], next)
    expect(got).not.toBeNull()
    expect(got!.matchIndex).toBe(0)
    expect(got!.lines[0].moves).toEqual(['e5', 'Nf3'])
    // The held siblings follow the carried tail, in their original order.
    expect(got!.lines.slice(1).map((l) => l.moves)).toEqual([['d4', 'd5']])
  })

  it('carries a non-top line and keeps the others behind it', () => {
    const next = after(START, 'd4')
    const got = carryLines(
      START,
      [line(['e4', 'e5']), line(['d4', 'd5', 'c4']), line(['Nf3', 'd5'])],
      next,
    )
    expect(got!.matchIndex).toBe(1)
    expect(got!.lines.map((l) => l.moves)).toEqual([['d5', 'c4'], ['e4', 'e5'], ['Nf3', 'd5']])
  })

  it('does not match on back navigation', () => {
    // Held lines are for the position after 1.e4; the user steps back to the start.
    const afterE4 = after(START, 'e4')
    expect(carryLines(afterE4, [line(['e5', 'Nf3'])], START)).toBeNull()
  })

  it('ignores the halfmove/fullmove counters when matching', () => {
    const next = after(START, 'e4')
    const fields = next.split(' ')
    const counterSkewed = [...fields.slice(0, 4), '7', '42'].join(' ')
    expect(carryLines(START, [line(['e4', 'e5'])], counterSkewed)).not.toBeNull()
  })

  it('treats illegal SAN as no match rather than throwing', () => {
    const next = after(START, 'e4')
    expect(() => carryLines(START, [line(['Qh5xh7#'])], next)).not.toThrow()
    expect(carryLines(START, [line(['Qh5xh7#'])], next)).toBeNull()
  })

  it('does not carry a one-move PV (the tail would be empty)', () => {
    const next = after(START, 'e4')
    expect(carryLines(START, [line(['e4'])], next)).toBeNull()
  })

  it('returns null for an empty held set', () => {
    expect(carryLines(START, [], after(START, 'e4'))).toBeNull()
  })
})

describe('carryLines score handling', () => {
  it('carries evaluation and shifts pvUci verbatim alongside the moves', () => {
    const next = after(START, 'e4')
    const got = carryLines(
      START,
      [line(['e4', 'e5', 'Nf3'], { evaluation: 0.42, pvUci: ['e2e4', 'e7e5', 'g1f3'] })],
      next,
    )
    expect(got!.lines[0].evaluation).toBe(0.42)
    expect(got!.lines[0].pvUci).toEqual(['e7e5', 'g1f3'])
  })

  it('decrements the mate count by one ply (white to move, M5 → M4)', () => {
    const next = after(START, 'e4')
    const got = carryLines(START, [line(['e4', 'e5', 'Nf3'], { mate: 5, evaluation: 99.99 })], next)
    expect(got!.lines[0].mate).toBe(4)
    // The sentinel's sign cannot change by playing a move of one's own mating line.
    expect(got!.lines[0].evaluation).toBe(99.99)
  })

  it('does not carry when the move being played delivers mate', () => {
    // Scholar's mate position: White to move, Qxf7# is M1.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
    const next = after(fen, 'Qxf7#')
    expect(carryLines(fen, [line(['Qxf7#', 'Kxf7'], { mate: 1, evaluation: 99.99 })], next))
      .toBeNull()
  })
})
