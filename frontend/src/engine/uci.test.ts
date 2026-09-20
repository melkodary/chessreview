import { describe, expect, it } from 'vitest'
import { parseInfo } from './uci'

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const WHITE_MATES_IN_1 = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'

describe('parseInfo — structure', () => {
  it('parses depth, multipv and pv as SAN from a white-to-move line', () => {
    const r = parseInfo(
      'info depth 18 seldepth 24 multipv 1 score cp 55 nodes 1000 pv e2e4 e7e5 g1f3',
      STARTPOS,
    )
    expect(r).not.toBeNull()
    expect(r!.depth).toBe(18)
    expect(r!.multipv).toBe(1)
    expect(r!.line.moves).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('defaults multipv to 1 when absent', () => {
    const r = parseInfo('info depth 5 score cp 10 pv e2e4', STARTPOS)
    expect(r!.multipv).toBe(1)
  })

  it('reads the multipv slot when present', () => {
    const r = parseInfo('info depth 12 multipv 3 score cp -20 pv d2d4', STARTPOS)
    expect(r!.multipv).toBe(3)
  })
})

describe('parseInfo — sign convention (white-relative parity)', () => {
  it('white to move, positive cp → positive pawns', () => {
    const r = parseInfo('info depth 10 score cp 55 pv e2e4', STARTPOS)
    expect(r!.line.evaluation).toBe(0.55)
    expect(r!.line.mate).toBeNull()
  })

  it('black to move, positive cp (good for black) → negative white-relative', () => {
    const r = parseInfo('info depth 10 score cp 30 pv e7e5', AFTER_E4)
    expect(r!.line.evaluation).toBe(-0.3)
    expect(r!.line.mate).toBeNull()
  })

  it('does not clamp large cp (parity with backend — no sentinel for cp)', () => {
    const r = parseInfo('info depth 10 score cp 1500 pv e2e4', STARTPOS)
    expect(r!.line.evaluation).toBe(15)
  })

  it('rounds cp to two decimals', () => {
    const r = parseInfo('info depth 10 score cp 34 pv e2e4', STARTPOS)
    expect(r!.line.evaluation).toBe(0.34)
  })
})

describe('parseInfo — mate sign + sentinel', () => {
  it('white to move, mate N>0 → mate N, +99.99 sentinel', () => {
    const r = parseInfo('info depth 20 score mate 3 pv e1e8', WHITE_MATES_IN_1)
    expect(r!.line.mate).toBe(3)
    expect(r!.line.evaluation).toBe(99.99)
  })

  it('white to move, mate negative (being mated) → mate -N, -99.99 sentinel', () => {
    const r = parseInfo('info depth 20 score mate -1 pv e2e4', STARTPOS)
    expect(r!.line.mate).toBe(-1)
    expect(r!.line.evaluation).toBe(-99.99)
  })

  it('black to move, mate N>0 (black mates) → white-relative mate -N, -99.99', () => {
    const r = parseInfo('info depth 20 score mate 2 pv e7e5', AFTER_E4)
    expect(r!.line.mate).toBe(-2)
    expect(r!.line.evaluation).toBe(-99.99)
  })
})

describe('parseInfo — pv conversion edge cases', () => {
  it('converts a promotion move to SAN', () => {
    const r = parseInfo('info depth 10 score cp 900 pv e7e8q', '7k/4P3/8/8/8/8/8/4K3 w - - 0 1')
    expect(r!.line.moves).toEqual(['e8=Q+'])
  })

  it('caps the pv at maxPv plies', () => {
    const r = parseInfo('info depth 10 score cp 10 pv e2e4 e7e5 g1f3 b8c6', STARTPOS, 2)
    expect(r!.line.moves).toEqual(['e4', 'e5'])
  })

  it('truncates the pv at the first illegal move', () => {
    const r = parseInfo('info depth 10 score cp 10 pv e2e4 e2e4', STARTPOS)
    expect(r!.line.moves).toEqual(['e4'])
  })
})

describe('parseInfo — malformed → null', () => {
  it('returns null for an info line with no score', () => {
    expect(parseInfo('info depth 5 currmove e2e4 currmovenumber 1', STARTPOS)).toBeNull()
  })

  it('returns null for an info line with no pv', () => {
    expect(parseInfo('info depth 5 score cp 20', STARTPOS)).toBeNull()
  })

  it('returns null for an info string line', () => {
    expect(parseInfo('info string NNUE evaluation using nn-xxxx', STARTPOS)).toBeNull()
  })

  it('returns null for a non-info line', () => {
    expect(parseInfo('bestmove e2e4 ponder e7e5', STARTPOS)).toBeNull()
  })

  it('returns null for an empty pv', () => {
    expect(parseInfo('info depth 5 score cp 20 pv', STARTPOS)).toBeNull()
  })
})
