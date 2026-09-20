import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { MoveReview } from '../api/review'
import ReviewGuide from './ReviewGuide'

const blunder: MoveReview = {
  ply: 7,
  san: 'e6',
  fenBefore: '',
  evalBefore: 0,
  evalAfterPlayed: 3.96,
  bestMoveSan: 'dxe6',
  winBefore: 50,
  winAfterPlayed: 10,
  winDrop: 40,
  classification: 'blunder',
  mateBefore: null,
  mateAfterPlayed: null,
}

describe('ReviewGuide', () => {
  it('renders the bubble for a move', () => {
    const { getByText } = render(<ReviewGuide move={blunder} />)
    expect(getByText('e6 is a blunder — best was dxe6')).toBeInTheDocument()
  })

  it('renders nothing at the start position (no move)', () => {
    const { container } = render(<ReviewGuide move={null} />)
    expect(container.firstChild).toBeNull()
  })
})
