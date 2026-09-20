import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import Board from './Board'

// react-chessboard is heavy and DOM-measuring; stub it, capturing the options
// the Board passes in so we can assert how interactivity is wired.
let lastOptions: Record<string, unknown> = {}
vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: Record<string, unknown> }) => {
    lastOptions = options
    return <div data-testid="chessboard-stub" />
  },
}))

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('Board badge', () => {
  it('renders a classification badge at the given square', () => {
    const { container } = render(
      <Board fen={FEN} badge={{ square: 'e6', classification: 'blunder' }} />,
    )
    const badge = container.querySelector('[data-badge="e6-blunder"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(container.querySelector('svg[data-classification="blunder"]')).not.toBeNull()
    // Positioned by percentage (square e: file 4 → (4+1)/8 = 62.5%).
    expect(badge.style.left).toBe('62.5%')
    expect(badge.style.top).toBe('25%') // rank 6 → (8-6)/8 = 25%
  })

  it('renders no badge when none is provided', () => {
    const { container } = render(<Board fen={FEN} />)
    expect(container.querySelector('[data-badge]')).toBeNull()
  })

  it('renders the forced badge (board badge only — no move-list/scoreboard gating here)', () => {
    const { container } = render(
      <Board fen={FEN} badge={{ square: 'e6', classification: 'forced' }} />,
    )
    expect(container.querySelector('[data-badge="e6-forced"]')).not.toBeNull()
    expect(container.querySelector('svg[data-classification="forced"]')).not.toBeNull()
  })

  it('renders a pending spinner (not a classification icon) for a pending badge', () => {
    const { container, getByTestId } = render(
      <Board fen={FEN} badge={{ square: 'e6', pending: true }} />,
    )
    const badge = container.querySelector('[data-badge="e6-pending"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(getByTestId('board-badge-pending')).not.toBeNull()
    expect(container.querySelector('svg[data-classification]')).toBeNull()
    // Same corner positioning as a graded badge.
    expect(badge.style.left).toBe('62.5%')
    expect(badge.style.top).toBe('25%')
  })
})

describe('Board interactivity', () => {
  it('is read-only by default: dragging off, no handlers', () => {
    render(<Board fen={FEN} />)
    expect(lastOptions.allowDragging).toBe(false)
    expect(lastOptions.onPieceDrop).toBeUndefined()
    expect(lastOptions.canDragPiece).toBeUndefined()
    expect(lastOptions.onSquareClick).toBeUndefined()
  })

  it('wires drag handlers and enables dragging when interactive', () => {
    const onPieceDrop = vi.fn(() => true)
    const canDragPiece = vi.fn(() => true)
    const onSquareClick = vi.fn()
    render(
      <Board
        fen={FEN}
        interactive
        onPieceDrop={onPieceDrop}
        canDragPiece={canDragPiece}
        onSquareClick={onSquareClick}
      />,
    )
    expect(lastOptions.allowDragging).toBe(true)
    expect(lastOptions.onPieceDrop).toBe(onPieceDrop)
    expect(lastOptions.canDragPiece).toBe(canDragPiece)
    expect(lastOptions.onSquareClick).toBe(onSquareClick)
  })

  it('passes squareStyles and onPieceDrag into options when provided', () => {
    const onPieceDrag = vi.fn()
    const squareStyles = { e4: { background: 'red' } }
    render(<Board fen={FEN} interactive onPieceDrag={onPieceDrag} squareStyles={squareStyles} />)
    expect(lastOptions.onPieceDrag).toBe(onPieceDrag)
    expect(lastOptions.squareStyles).toBe(squareStyles)
  })

  it('omits squareStyles and onPieceDrag by default', () => {
    render(<Board fen={FEN} />)
    expect(lastOptions.onPieceDrag).toBeUndefined()
    expect(lastOptions.squareStyles).toBeUndefined()
  })
})
