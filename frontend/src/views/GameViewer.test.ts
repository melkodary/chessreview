import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { buildPositions } from '../hooks/useGameViewer'

const STARTING_FEN = new Chess().fen()

const PGN_THREE_MOVES = `[Event "Test"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "a"]
[Black "b"]
[Result "*"]

1. e4 e5 2. Nf3 *`

describe('buildPositions', () => {
  it('returns starting position for empty PGN', () => {
    const positions = buildPositions('')
    expect(positions).toHaveLength(1)
    expect(positions[0].fen).toBe(STARTING_FEN)
    expect(positions[0].san).toBeNull()
  })

  it('returns N+1 positions for N moves', () => {
    const positions = buildPositions(PGN_THREE_MOVES)
    expect(positions).toHaveLength(4)
  })

  it('first entry is starting position with null san', () => {
    const positions = buildPositions(PGN_THREE_MOVES)
    expect(positions[0].fen).toBe(STARTING_FEN)
    expect(positions[0].san).toBeNull()
  })

  it('SAN values match the PGN move order', () => {
    const positions = buildPositions(PGN_THREE_MOVES)
    expect(positions.slice(1).map((p) => p.san)).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('final fen matches manual replay', () => {
    const replay = new Chess()
    replay.move('e4')
    replay.move('e5')
    replay.move('Nf3')

    const positions = buildPositions(PGN_THREE_MOVES)
    expect(positions[positions.length - 1].fen).toBe(replay.fen())
  })
})
