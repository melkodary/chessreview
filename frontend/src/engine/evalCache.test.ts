import { describe, it, expect, beforeEach } from 'vitest'
import type { AnalysisLine } from '../api/analyzer'
import { putEval, getEval, clearEvalCache } from './evalCache'

function line(evaluation: number, pvUci: string[]): AnalysisLine {
  return { moves: [], evaluation, mate: null, pvUci }
}

describe('evalCache', () => {
  beforeEach(() => clearEvalCache())

  it('stores and returns a position by fen', () => {
    putEval('fenA', [line(0.3, ['e2e4'])], 18)
    expect(getEval('fenA')).toEqual({ lines: [line(0.3, ['e2e4'])], depth: 18, multipv: 1 })
  })

  it('returns undefined for an unknown fen', () => {
    expect(getEval('nope')).toBeUndefined()
  })

  it('keeps the deepest entry at one width — deeper wins, shallower does not regress', () => {
    putEval('f', [line(0.1, ['a2a4'])], 12)
    putEval('f', [line(0.2, ['b2b4'])], 20) // deeper wins
    expect(getEval('f')?.depth).toBe(20)
    putEval('f', [line(0.9, ['c2c4'])], 5) // shallower re-visit must not regress
    expect(getEval('f')?.depth).toBe(20)
    expect(getEval('f')?.lines[0].evaluation).toBe(0.2)
  })

  it('keeps both entries when neither write beats the other', () => {
    putEval('f', [line(0.1, ['a2a4']), line(0.0, ['b2b4'])], 18) // wide, shallower
    putEval('f', [line(0.3, ['c2c4'])], 25) // deep, narrow
    expect(getEval('f', 2)?.depth).toBe(18) // grader still finds its rank-2 line
    expect(getEval('f', 1)?.depth).toBe(25) // eval bar still finds the deep one
  })

  it('a wide shallow write does not evict a deep narrow one', () => {
    putEval('f', [line(0.1, ['a2a4']), line(0.0, ['b2b4'])], 18) // a graded ply
    putEval('f', [line(0.2, ['c2c4']), line(0.1, ['d2d4']), line(0, ['e2e4'])], 6) // eval bar's first frame
    expect(getEval('f', 2, 18)?.depth).toBe(18)
  })

  it('serves the width searched for even when the engine returned fewer lines', () => {
    putEval('forced', [line(0.1, ['a2a4'])], 18, 2) // one legal move, searched at MultiPV 2
    expect(getEval('forced', 2)?.depth).toBe(18)
  })

  it('refuses a hit narrower or shallower than asked for', () => {
    putEval('f', [line(0.1, ['a2a4'])], 18)
    expect(getEval('f', 1)?.depth).toBe(18)
    expect(getEval('f', 2)).toBeUndefined()
    expect(getEval('f', 1, 20)).toBeUndefined()
  })

  it('ignores a write beaten on both depth and width', () => {
    putEval('f', [line(0.1, ['a2a4']), line(0.0, ['b2b4'])], 20)
    putEval('f', [line(0.9, ['c2c4'])], 12) // worse on both -> not stored
    expect(getEval('f', 2)?.depth).toBe(20)
    expect(getEval('f', 2)?.lines[0].evaluation).toBe(0.1)
    expect(getEval('f', 1)?.lines[0].evaluation).toBe(0.1)
  })

  it('bounds the per-fen frontier, dropping the shallowest', () => {
    for (let w = 1; w <= 6; w++) putEval('f', [line(0, [])], 30 - w, w)
    expect(getEval('f', 1)?.depth).toBe(29)
    expect(getEval('f', 4)?.depth).toBe(26)
    expect(getEval('f', 5)).toBeUndefined()
    expect(getEval('f', 6)).toBeUndefined()
  })

  it('freshens a dominated entry so a re-hit is not evicted as stale', () => {
    putEval('keep', [line(0.1, ['a2a4'])], 20)
    for (let i = 0; i < 200; i++) putEval(`f${i}`, [line(0, [])], 18)
    putEval('keep', [line(0.1, ['a2a4'])], 20) // dominated write, still moves to newest
    for (let i = 200; i < 300; i++) putEval(`f${i}`, [line(0, [])], 18)
    expect(getEval('keep')?.depth).toBe(20)
  })

  it('evicts the oldest fen past the bound', () => {
    for (let i = 0; i < 300; i++) putEval(`f${i}`, [line(0, [])], 18)
    expect(getEval('f0')).toBeUndefined() // oldest evicted
    expect(getEval('f299')).toBeDefined() // newest kept
  })
})
