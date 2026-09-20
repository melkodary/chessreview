import { describe, expect, it } from 'vitest'
import { explainPrev } from './explainPrev'

const AFTER_1_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

describe('explainPrev', () => {
  it('renders the previous ply as fen + uci', () => {
    expect(explainPrev(AFTER_1_E4, 'e5')).toEqual({
      prevFen: AFTER_1_E4,
      prevUci: 'e7e5',
    })
  })

  it('keeps the promotion piece in the uci', () => {
    const fen = '8/P7/8/8/8/8/8/K6k w - - 0 1'
    expect(explainPrev(fen, 'a8=Q').prevUci).toBe('a7a8q')
  })

  it('sends nothing when either half is missing', () => {
    expect(explainPrev(undefined, 'e5')).toEqual({})
    expect(explainPrev(AFTER_1_E4, undefined)).toEqual({})
    expect(explainPrev(AFTER_1_E4, null)).toEqual({})
  })

  it('sends nothing when the pair does not parse', () => {
    // Degrading to "not supplied" is the point: the backend reads that as
    // unknown, where a wrong pair would be a wrong fact.
    expect(explainPrev(AFTER_1_E4, 'Qxh8')).toEqual({})
    expect(explainPrev('not a fen', 'e5')).toEqual({})
  })
})
