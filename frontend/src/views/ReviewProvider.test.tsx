import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SettingsProvider } from '../settings'
import { ReviewProvider } from './ReviewProvider'
import { useReview } from './reviewContext'

vi.mock('../api/analyzer', () => ({
  createReview: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
  getReview: vi.fn().mockImplementation(() => new Promise(() => {})),
  cancelReview: vi.fn().mockResolvedValue(undefined),
  listReviews: vi.fn().mockResolvedValue([]),
}))

// Grading inputs come from GameShell in the app; these tests only exercise view state.
function Wrap({ pgn, children }: { pgn: string; children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ReviewProvider pgn={pgn} branch={[]} forkFen="" forkPly={0} gradingEnabled={false}>
        {children}
      </ReviewProvider>
    </SettingsProvider>
  )
}

function Probe() {
  const { reviewView, setReviewView } = useReview()
  return (
    <button data-testid="probe" data-view={reviewView} onClick={() => setReviewView('walkthrough')}>
      x
    </button>
  )
}

describe('ReviewProvider reviewView', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('defaults to summary', () => {
    const { getByTestId } = render(<Wrap pgn="1. e4 *"><Probe /></Wrap>)
    expect(getByTestId('probe').getAttribute('data-view')).toBe('summary')
  })

  it('survives a remount of the child (tab-switch) while the provider stays mounted', () => {
    const { getByTestId, rerender } = render(
      <Wrap pgn="1. e4 *"><Probe /></Wrap>,
    )
    fireEvent.click(getByTestId('probe'))
    expect(getByTestId('probe').getAttribute('data-view')).toBe('walkthrough')

    // Simulate leaving the Review tab (child unmounts) and coming back (remounts)
    // without the provider itself remounting — same pattern as GameShell's
    // ReviewProvider sitting above the tab Outlet.
    rerender(<Wrap pgn="1. e4 *"><div data-testid="other" /></Wrap>)
    rerender(<Wrap pgn="1. e4 *"><Probe /></Wrap>)
    expect(getByTestId('probe').getAttribute('data-view')).toBe('walkthrough')
  })

  it('resets to summary when the game (pgn) changes', () => {
    const { getByTestId, rerender } = render(
      <Wrap pgn="1. e4 *"><Probe /></Wrap>,
    )
    fireEvent.click(getByTestId('probe'))
    expect(getByTestId('probe').getAttribute('data-view')).toBe('walkthrough')

    rerender(<Wrap pgn="1. d4 *"><Probe /></Wrap>)
    expect(getByTestId('probe').getAttribute('data-view')).toBe('summary')
  })
})
