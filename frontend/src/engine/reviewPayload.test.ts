import { describe, it, expect, beforeEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'
import { putEval, clearEvalCache } from './evalCache'
import { buildReviewPayload, isTerminalFen } from './reviewPayload'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
// 1. f3 e5 2. g4 Qh4# — the after-position of the last ply is checkmate.
const BEFORE_MATE = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'

function line(evaluation: number, pvUci: string[], mate: number | null = null): AnalysisLine {
  return { moves: [], evaluation, mate, pvUci }
}

const POSITIONS = [{ fen: START }, { fen: AFTER_E4 }, { fen: AFTER_E4_E5 }]

describe('buildReviewPayload', () => {
  beforeEach(() => clearEvalCache())

  it('binds every ply to its positions with the cached lines at the request depth/width', () => {
    putEval(START, [line(0.3, ['e2e4']), line(0.2, ['d2d4'])], 18, 2)
    putEval(AFTER_E4, [line(0.1, ['e7e5']), line(0.0, ['c7c5'])], 18, 2)
    putEval(AFTER_E4_E5, [line(0.25, ['g1f3']), line(0.2, ['b1c3'], null)], 20, 2)

    expect(buildReviewPayload(POSITIONS, 18, 2)).toEqual([
      {
        fenBefore: START, fenAfter: AFTER_E4,
        beforeLines: [{ uci: 'e2e4', cp: 30 }, { uci: 'd2d4', cp: 20 }],
        afterEval: { cp: 10 },
      },
      {
        fenBefore: AFTER_E4, fenAfter: AFTER_E4_E5,
        beforeLines: [{ uci: 'e7e5', cp: 10 }, { uci: 'c7c5', cp: 0 }],
        afterEval: { cp: 25 },
      },
    ])
  })

  it('is null when any position is missing or too shallow — never a partial payload', () => {
    putEval(START, [line(0.3, ['e2e4']), line(0.2, ['d2d4'])], 18, 2)
    putEval(AFTER_E4, [line(0.1, ['e7e5']), line(0.0, ['c7c5'])], 18, 2)
    expect(buildReviewPayload(POSITIONS, 18, 2)).toBeNull()
    putEval(AFTER_E4_E5, [line(0.25, ['g1f3']), line(0.2, ['b1c3'])], 12, 2) // shallow
    expect(buildReviewPayload(POSITIONS, 18, 2)).toBeNull()
  })

  it('a MultiPV-1 entry never satisfies a MultiPV-2 request (the evalCache prerequisite)', () => {
    putEval(START, [line(0.3, ['e2e4'])], 18, 1)
    putEval(AFTER_E4, [line(0.1, ['e7e5']), line(0.0, ['c7c5'])], 18, 2)
    putEval(AFTER_E4_E5, [line(0.25, ['g1f3']), line(0.2, ['b1c3'])], 18, 2)
    expect(buildReviewPayload(POSITIONS, 18, 2)).toBeNull()
  })

  it('sends a forced ply with the single line its MultiPV-2 search found', () => {
    putEval(START, [line(0.3, ['e2e4'])], 18, 2) // one legal move: width 2, one line
    putEval(AFTER_E4, [line(0.1, ['e7e5']), line(0.0, ['c7c5'])], 18, 2)
    putEval(AFTER_E4_E5, [line(0.25, ['g1f3']), line(0.2, ['b1c3'])], 18, 2)
    expect(buildReviewPayload(POSITIONS, 18, 2)?.[0].beforeLines).toEqual([{ uci: 'e2e4', cp: 30 }])
  })

  it('omits afterEval for a terminal after-position, which is never searched', () => {
    putEval(BEFORE_MATE, [line(-99.99, ['d8h4'], -1), line(-0.5, ['d8e7'])], 18, 2)
    expect(isTerminalFen(MATED)).toBe(true)
    expect(buildReviewPayload([{ fen: BEFORE_MATE }, { fen: MATED }], 18, 2)).toEqual([{
      fenBefore: BEFORE_MATE, fenAfter: MATED,
      beforeLines: [{ uci: 'd8h4', mate: -1 }, { uci: 'd8e7', cp: -50 }],
    }])
  })
})
