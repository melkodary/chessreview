import { describe, it, expect } from 'vitest'
import { moveTimesSpent } from './moveTimes'

// base 180, inc 2. clk: e4 2:58 (178), e5 2:57 (177), Nf3 2:56 (176).
const CLOCKED =
  '[TimeControl "180+2"]\n\n1. e4 {[%clk 0:02:58]} e5 {[%clk 0:02:57]} 2. Nf3 {[%clk 0:02:56]} *'

const NO_CLOCKS = '1. e4 e5 2. Nf3 *'

// 3 plies but only 2 clocks → misaligned → inert.
const PARTIAL = '1. e4 {[%clk 0:02:58]} e5 {[%clk 0:02:57]} 2. Nf3 *'

// daily / unlimited: no usable base → first move of each side is null.
const DAILY =
  '[TimeControl "-"]\n\n1. e4 {[%clk 0:02:58]} e5 {[%clk 0:02:57]} 2. Nf3 {[%clk 0:02:56]} *'

describe('moveTimesSpent', () => {
  it('derives spent per ply including first moves (base) and increment', () => {
    // w e4: 180-178+2=4; b e5: 180-177+2=5; w Nf3: 178-176+2=4
    expect(moveTimesSpent(CLOCKED)).toEqual([4, 5, 4])
  })

  it('returns [] for a clockless game', () => {
    expect(moveTimesSpent(NO_CLOCKS)).toEqual([])
  })

  it('returns [] when clock count does not match move count', () => {
    expect(moveTimesSpent(PARTIAL)).toEqual([])
  })

  it('yields null first moves under a baseless time control', () => {
    // no base → ply0/ply1 null; w Nf3: 178-176+0=2
    expect(moveTimesSpent(DAILY)).toEqual([null, null, 2])
  })
})
