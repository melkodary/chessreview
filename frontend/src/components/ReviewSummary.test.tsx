import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import ReviewSummary from './ReviewSummary'

const FIXTURE = {
  white: { accuracy: 91.4, counts: { best: 8, blunder: 1 }, biggestBlunderPly: 17 },
  black: { accuracy: 86.2, counts: { mistake: 2 }, biggestBlunderPly: null },
  keyMoments: [],
  opening: null,
}

const PROPS = {
  summary: FIXTURE,
  whiteName: 'alice',
  blackName: 'bob',
  isUserWhite: true,
}

describe('ReviewSummary', () => {
  it('renders both player names in the header', () => {
    render(<ReviewSummary {...PROPS} />)
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
  })

  it('renders both side accuracies', () => {
    render(<ReviewSummary {...PROPS} />)
    expect(screen.getByText(/91.4/)).toBeInTheDocument()
    expect(screen.getByText(/86.2/)).toBeInTheDocument()
  })

  it('renders Game ratings in one footer after classification rows', () => {
    const withGameRatings = {
      ...FIXTURE,
      white: { ...FIXTURE.white, gameRating: 1400 },
      black: { ...FIXTURE.black, gameRating: 1200 },
      gameRatingAlgorithm: 'formula-v1',
    }
    const { container } = render(<ReviewSummary {...PROPS} summary={withGameRatings} />)
    const ratingFooter = container.querySelector('[data-game-rating-row]')

    expect(ratingFooter).not.toBeNull()
    expect(screen.getAllByText('Game rating')).toHaveLength(1)
    expect(ratingFooter).toHaveTextContent('1,400')
    expect(ratingFooter).toHaveTextContent('1,200')
    const classificationRows = container.querySelectorAll('[data-classification]')
    expect(classificationRows[classificationRows.length - 1].closest('[data-row]')?.nextElementSibling)
      .toBe(ratingFooter)
  })

  it('omits Game rating lines for old saved summaries', () => {
    render(<ReviewSummary {...PROPS} />)
    expect(screen.queryByText('Game rating')).toBeNull()
  })

  it('renders all 10 classification rows including zero-count ones', () => {
    const { container } = render(<ReviewSummary {...PROPS} />)
    const icons = container.querySelectorAll('[data-classification]')
    expect(icons.length).toBe(10)
    // excellent has count 0 for both sides but its row still renders
    expect(container.querySelector('[data-classification="excellent"]')).not.toBeNull()
  })

  it('shows a zero count for classifications neither side played', () => {
    const { container } = render(<ReviewSummary {...PROPS} />)
    const excellentRow = container
      .querySelector('[data-classification="excellent"]')!
      .closest('[data-row]')!
    expect(excellentRow.textContent).toMatch(/0/)
  })

  it('renders em-dash for accuracy when null (live partial summary)', () => {
    const partial = {
      white: { accuracy: null, counts: { best: 3 }, biggestBlunderPly: null },
      black: { accuracy: null, counts: { blunder: 1 }, biggestBlunderPly: null },
      keyMoments: [],
      opening: null,
    }
    const { container } = render(<ReviewSummary {...PROPS} summary={partial} />)
    const headerRow = container.querySelector('[data-row]:nth-child(1)')!
    expect(headerRow.textContent).toContain('—')
    expect(headerRow.textContent).not.toMatch(/\d+\.\d/)
  })

  it('omits forced from the scoreboard (10 rows, not 11)', () => {
    const withForced = {
      ...FIXTURE,
      white: { ...FIXTURE.white, counts: { ...FIXTURE.white.counts, forced: 2 } },
    }
    const { container } = render(<ReviewSummary {...PROPS} summary={withForced} />)
    expect(container.querySelectorAll('[data-classification]').length).toBe(10)
    expect(container.querySelector('[data-classification="forced"]')).toBeNull()
  })

  it('does not render the opening / book line', () => {
    const withOpening = {
      ...FIXTURE,
      opening: { eco: 'C65', name: 'Ruy López, Berlin Defense', untilPly: 5 },
    }
    render(<ReviewSummary {...PROPS} summary={withOpening} />)
    expect(screen.queryByText('C65')).toBeNull()
    expect(screen.queryByText(/Left book/i)).toBeNull()
  })

  it('renders a provenance marker for a frontend-sourced review', () => {
    render(<ReviewSummary {...PROPS} engineSource="frontend" />)
    expect(screen.getByTestId('review-provenance')).toBeInTheDocument()
  })

  it('renders no provenance marker for a backend-sourced review', () => {
    render(<ReviewSummary {...PROPS} engineSource="backend" />)
    expect(screen.queryByTestId('review-provenance')).toBeNull()
  })

  it('renders no provenance marker while engineSource is unsettled', () => {
    render(<ReviewSummary {...PROPS} engineSource={null} />)
    expect(screen.queryByTestId('review-provenance')).toBeNull()
  })
})
