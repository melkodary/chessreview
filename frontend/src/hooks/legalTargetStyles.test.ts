import { describe, it, expect } from 'vitest'
import { buildLegalTargetStyles } from './legalTargetStyles'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// White pawn on e5 can capture the black pawn on d6 (or push to e6).
const CAPTURE = 'rnbqkbnr/ppp1pppp/3p4/4P3/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1'
// White pawn one step from promotion; black king on e8.
const PROMO = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'

const DOT = 'radial-gradient(circle, var(--hint-dot) 0 19%, transparent 20%)'
const RING =
  'radial-gradient(circle closest-side, transparent 0 84%, var(--hint-ring) 85% 94%, transparent 95%)'

describe('buildLegalTargetStyles', () => {
  it('marks pawn pushes with the dot and tints the pickup square', () => {
    const styles = buildLegalTargetStyles(START, 'e2')
    expect(styles.e2).toEqual({ background: 'var(--hint-pickup)' })
    expect(styles.e3).toEqual({ background: DOT })
    expect(styles.e4).toEqual({ background: DOT })
  })

  it('marks a capturable square with the ring', () => {
    const styles = buildLegalTargetStyles(CAPTURE, 'e5')
    expect(styles.d6).toEqual({ background: RING }) // capture
    expect(styles.e6).toEqual({ background: DOT }) // quiet push
  })

  it('returns {} for a null square', () => {
    expect(buildLegalTargetStyles(START, null)).toEqual({})
  })

  it('returns {} for an empty square', () => {
    expect(buildLegalTargetStyles(START, 'e4')).toEqual({})
  })

  it('returns {} for an off-turn piece', () => {
    expect(buildLegalTargetStyles(START, 'e7')).toEqual({}) // black, white to move
  })

  it('dedups a promotion to one entry per target square', () => {
    const styles = buildLegalTargetStyles(PROMO, 'a7')
    expect(styles.a8).toEqual({ background: DOT }) // four promo moves, one square
  })
})
