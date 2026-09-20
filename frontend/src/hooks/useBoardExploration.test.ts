import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardExploration, type ExploreTab } from './useBoardExploration'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// White pawn one step from promotion; black king on e8.
const PROMO = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'

function setup(baseFen = START, moveIndex = 0, pgn = 'x', tab: ExploreTab = 'Review') {
  return renderHook(
    (props: { baseFen: string; moveIndex: number; pgn: string; tab: ExploreTab }) =>
      useBoardExploration(props),
    { initialProps: { baseFen, moveIndex, pgn, tab } },
  )
}

describe('useBoardExploration', () => {
  it('starts not exploring; effectiveFen is the base', () => {
    const { result } = setup()
    expect(result.current.exploring).toBe(false)
    expect(result.current.effectiveFen).toBe(START)
    expect(result.current.branch).toEqual([])
  })

  it('legal drop seeds the branch and advances to the tip', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    expect(ok).toBe(true)
    expect(result.current.exploring).toBe(true)
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
    expect(result.current.branchIndex).toBe(1)
    expect(result.current.effectiveFen).toContain(' b ') // black to move now
  })

  it('legal UCI move seeds the branch and advances to the tip', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.playUci('e2e4') })
    expect(ok).toBe(true)
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
    expect(result.current.branchIndex).toBe(1)
    expect(result.current.effectiveFen).toContain(' b ')
  })

  it('preserves the UCI promotion piece', () => {
    const { result } = setup(PROMO)
    act(() => { result.current.playUci('a7a8n') })
    expect(result.current.branch.at(-1)?.san).toContain('=N')
    expect(result.current.effectiveFen.split(' ')[0]).toContain('N')
  })

  it('rejects malformed UCI without changing the branch', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.playUci('e2') })
    expect(ok).toBe(false)
    expect(result.current.branch).toEqual([])
  })

  it('rejects illegal UCI without changing the branch', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.playUci('e2e5') })
    expect(ok).toBe(false)
    expect(result.current.branch).toEqual([])
  })

  it('UCI move truncates forward nodes on divergence', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    act(() => { result.current.back() })
    act(() => { result.current.playUci('c7c5') })
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4', 'c5'])
    expect(result.current.branchIndex).toBe(2)
  })

  it('illegal drop returns false and leaves state unchanged', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e5' }) })
    expect(ok).toBe(false)
    expect(result.current.exploring).toBe(false)
  })

  it('rejects a drop with no target square', () => {
    const { result } = setup()
    let ok!: boolean
    act(() => { ok = result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: null }) })
    expect(ok).toBe(false)
  })

  it('canDragPiece allows only the side to move', () => {
    const { result } = setup()
    expect(result.current.canDragPiece({ piece: { pieceType: 'wP' }, square: 'e2' })).toBe(true)
    expect(result.current.canDragPiece({ piece: { pieceType: 'bP' }, square: 'e7' })).toBe(false)
  })

  it('auto-queens a promotion', () => {
    const { result } = setup(PROMO)
    act(() => { result.current.onPieceDrop({ sourceSquare: 'a7', targetSquare: 'a8' }) })
    expect(result.current.branch.at(-1)!.san).toContain('=Q')
    expect(result.current.effectiveFen.split(' ')[0]).toContain('Q')
  })

  it('forward/back step the branch; back at the fork exits', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4', 'e5'])
    expect(result.current.branchIndex).toBe(2)

    act(() => { result.current.back() })
    expect(result.current.branchIndex).toBe(1)
    expect(result.current.effectiveFen).toContain(' b ')

    act(() => { result.current.forward() })
    expect(result.current.branchIndex).toBe(2)

    act(() => { result.current.back() }) // -> 1
    act(() => { result.current.back() }) // -> 0 (fork, still exploring)
    expect(result.current.branchIndex).toBe(0)
    expect(result.current.exploring).toBe(true)
    expect(result.current.effectiveFen).toBe(START)

    act(() => { result.current.back() }) // exit
    expect(result.current.exploring).toBe(false)
  })

  it('forward caps at the tip', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.forward() })
    act(() => { result.current.forward() })
    expect(result.current.branchIndex).toBe(1)
  })

  it('truncates forward nodes on divergence', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    act(() => { result.current.back() }) // back to after e4 (black to move)
    act(() => { result.current.onPieceDrop({ sourceSquare: 'c7', targetSquare: 'c5' }) })
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4', 'c5'])
    expect(result.current.branchIndex).toBe(2)
  })

  it('selectBranch jumps to a node', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    act(() => { result.current.selectBranch(1) })
    expect(result.current.branchIndex).toBe(1)
    expect(result.current.effectiveFen).toContain(' b ')
  })

  it('tap-to-move: first tap selects, second applies', () => {
    const { result } = setup()
    act(() => { result.current.onSquareClick({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    expect(result.current.exploring).toBe(false) // selected, not moved
    act(() => { result.current.onSquareClick({ piece: null, square: 'e4' }) })
    expect(result.current.exploring).toBe(true)
    expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
  })

  it('onSquareClick returns true only when a move is committed', () => {
    const { result } = setup()
    let selected!: boolean
    act(() => { selected = result.current.onSquareClick({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    expect(selected).toBe(false)
    let moved!: boolean
    act(() => { moved = result.current.onSquareClick({ piece: null, square: 'e4' }) })
    expect(moved).toBe(true)
  })

  it('onSquareClick returns false when the second tap is illegal (reselect instead)', () => {
    const { result } = setup()
    act(() => { result.current.onSquareClick({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    let ok!: boolean
    act(() => { ok = result.current.onSquareClick({ piece: { pieceType: 'wN' }, square: 'b1' }) })
    expect(ok).toBe(false)
    expect(result.current.exploring).toBe(false)
  })

  it('onPieceDrag on a side-to-move piece populates squareStyles', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrag({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    expect(result.current.squareStyles.e2).toBeDefined() // pickup tint
    expect(result.current.squareStyles.e4).toBeDefined() // legal target
  })

  it('onPieceDrop clears squareStyles', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrag({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    expect(result.current.squareStyles).toEqual({})
  })

  it('an off-turn onPieceDrag leaves squareStyles empty', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrag({ piece: { pieceType: 'bP' }, square: 'e7' }) })
    expect(result.current.squareStyles).toEqual({})
  })

  it('tap-select populates squareStyles', () => {
    const { result } = setup()
    act(() => { result.current.onSquareClick({ piece: { pieceType: 'wP' }, square: 'e2' }) })
    expect(result.current.squareStyles.e2).toBeDefined()
    expect(result.current.squareStyles.e4).toBeDefined()
  })

  it('reset clears the branch', () => {
    const { result } = setup()
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { result.current.reset() })
    expect(result.current.exploring).toBe(false)
    expect(result.current.effectiveFen).toBe(START)
  })

  it('clears when moveIndex changes (game navigation)', () => {
    const { result, rerender } = setup(START, 0, 'x')
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    expect(result.current.exploring).toBe(true)
    rerender({ baseFen: START, moveIndex: 1, pgn: 'x', tab: 'Review' })
    expect(result.current.exploring).toBe(false)
  })

  it('clears when pgn changes (new game)', () => {
    const { result, rerender } = setup(START, 0, 'x')
    act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    rerender({ baseFen: START, moveIndex: 0, pgn: 'y', tab: 'Review' })
    expect(result.current.exploring).toBe(false)
  })

  // Asymmetric tab carry: Review → Analysis carries the branch, Analysis →
  // Review restores it as Review last saw it. Analysis is a scratchpad.
  describe('tab carry', () => {
    const toTab = (tab: ExploreTab) => ({ baseFen: START, moveIndex: 0, pgn: 'x', tab })

    it('Review → Analysis carries the branch', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      rerender(toTab('Analysis'))
      expect(result.current.exploring).toBe(true)
      expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
      expect(result.current.branchIndex).toBe(1)
    })

    it('Analysis → Review discards plies explored on Analysis', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      rerender(toTab('Analysis'))
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
      expect(result.current.branch.map((n) => n.san)).toEqual(['e4', 'e5'])
      rerender(toTab('Review'))
      expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
      expect(result.current.branchIndex).toBe(1)
    })

    it('restores the branch cursor, not just the line', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e7', targetSquare: 'e5' }) })
      act(() => { result.current.selectBranch(1) }) // step back to after 1.e4
      rerender(toTab('Analysis'))
      act(() => { result.current.forward() })
      expect(result.current.branchIndex).toBe(2)
      rerender(toTab('Review'))
      expect(result.current.branchIndex).toBe(1)
    })

    it('Reset on Analysis is local — Review gets its branch back', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      rerender(toTab('Analysis'))
      act(() => { result.current.reset() })
      expect(result.current.exploring).toBe(false)
      rerender(toTab('Review'))
      expect(result.current.branch.map((n) => n.san)).toEqual(['e4'])
    })

    it('game navigation on Analysis drops the snapshot too', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      rerender(toTab('Analysis'))
      rerender({ baseFen: START, moveIndex: 1, pgn: 'x', tab: 'Analysis' })
      expect(result.current.exploring).toBe(false)
      rerender({ baseFen: START, moveIndex: 1, pgn: 'x', tab: 'Review' })
      expect(result.current.exploring).toBe(false)
    })

    it('nav wins when a game navigation and a tab flip land together', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      rerender(toTab('Analysis'))
      // Back to Review *and* a game nav in the same render: the branch clears
      // rather than restoring at a fork ply that no longer exists.
      rerender({ baseFen: START, moveIndex: 1, pgn: 'x', tab: 'Review' })
      expect(result.current.exploring).toBe(false)
    })

    it('round trip with no branch is a no-op', () => {
      const { result, rerender } = setup()
      rerender(toTab('Analysis'))
      rerender(toTab('Review'))
      expect(result.current.exploring).toBe(false)
      expect(result.current.effectiveFen).toBe(START)
    })
  })

  // Consumers memo on `branch`, and one of those memos feeds the board overlay
  // whose effect sets state on the shell that re-renders this hook. A fresh
  // array per render closes that cycle into an infinite render loop.
  describe('branch identity', () => {
    it('is unchanged across a re-render with the same props', () => {
      const { result, rerender } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      const first = result.current.branch
      rerender({ baseFen: START, moveIndex: 0, pgn: 'x', tab: 'Review' })
      expect(result.current.branch).toBe(first)
    })

    it('is unchanged when only branchIndex moves', () => {
      const { result } = setup()
      act(() => { result.current.onPieceDrop({ sourceSquare: 'e2', targetSquare: 'e4' }) })
      const first = result.current.branch
      act(() => { result.current.back() })
      expect(result.current.branchIndex).toBe(0)
      expect(result.current.branch).toBe(first)
    })
  })
})
