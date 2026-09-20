import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { Classification, MoveReview } from '../api/review'
import GuideBubble from './GuideBubble'

function move(partial: Partial<MoveReview> & { classification: Classification }): MoveReview {
  return {
    ply: 1,
    san: 'e4',
    fenBefore: '',
    evalBefore: 0,
    evalAfterPlayed: 0,
    bestMoveSan: 'e4',
    winBefore: 50,
    winAfterPlayed: 50,
    winDrop: 0,
    mateBefore: null,
    mateAfterPlayed: null,
    ...partial,
  }
}

describe('GuideBubble', () => {
  it('renders the heuristic sentence and the classification icon', () => {
    const { container, getByText } = render(
      <GuideBubble move={move({ san: 'e6', bestMoveSan: 'dxe6', classification: 'blunder', evalAfterPlayed: 3.96 })} />,
    )
    expect(getByText('e6 is a blunder — best was dxe6')).toBeInTheDocument()
    expect(container.querySelector('svg[data-classification="blunder"]')).not.toBeNull()
  })

  it('shows a signed two-decimal eval badge', () => {
    const { getByText } = render(
      <GuideBubble move={move({ classification: 'blunder', evalAfterPlayed: 3.96 })} />,
    )
    expect(getByText('+3.96')).toBeInTheDocument()
  })

  it('shows negative evals with a minus sign', () => {
    const { getByText } = render(
      <GuideBubble move={move({ classification: 'mistake', evalAfterPlayed: -1.2 })} />,
    )
    expect(getByText('-1.20')).toBeInTheDocument()
  })

  it('shows M# instead of the sentinel eval on a mate move', () => {
    const { getByText } = render(
      <GuideBubble move={move({ classification: 'blunder', evalAfterPlayed: -99.99, mateAfterPlayed: 2 })} />,
    )
    expect(getByText('M2')).toBeInTheDocument()
  })

  it.each(['blunder', 'brilliant'] as const)('bubble border-left uses --review-%s color', (c) => {
    const { container } = render(<GuideBubble move={move({ classification: c })} />)
    const bubble = container.firstChild as HTMLElement
    expect(bubble.style.borderLeft).toContain(`var(--review-${c})`)
  })
})
