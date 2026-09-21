import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '../settings'
import GameShell from './GameShell'
import { useGameShell } from './gameShellContext'
import type { Game } from '../api/types'

vi.mock('../api/analyzer', () => ({
  createReview: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
  getReview: vi.fn().mockImplementation(() => new Promise(() => {})),
  cancelReview: vi.fn().mockResolvedValue(undefined),
  listReviews: vi.fn().mockResolvedValue([]),
}))

function fakeGame(): Game {
  return {
    source: 'lichess',
    id: '1',
    white: { username: 'alice', result: 'win', rating: 1500 },
    black: { username: 'bob', result: 'loss', rating: 1400 },
    pgn: '',
    endTime: 0,
    url: 'https://lichess.org/1',
  }
}

// The shell fetches the game; serve it synchronously.
vi.mock('../hooks/useGame', () => ({
  useGame: () => ({ data: fakeGame(), loading: false, error: null }),
}))

// react-chessboard is heavy; replace with a marker stub. Sizing is now pure
// CSS, so the stub no longer needs to echo a px size.
vi.mock('../components/Board', () => ({
  default: () => <div data-testid="board" />,
}))

function renderShell(path = '/alice/games/1/review') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>
        <Routes>
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route path="review" element={<div data-testid="panel" />} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

function AnalysisStatusPanel() {
  const { setAnalysisStatus } = useGameShell()
  useEffect(() => {
    setAnalysisStatus({ depth: 18, settled: false })
    return () => setAnalysisStatus(null)
  }, [setAnalysisStatus])
  return <div data-testid="panel" />
}

function renderAnalysisShell() {
  return render(
    <MemoryRouter initialEntries={['/alice/games/1/analyze']}>
      <SettingsProvider>
        <Routes>
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route path="analyze" element={<AnalysisStatusPanel />} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

describe('GameShell layout', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the mode tabs and the routed panel', () => {
    const { getByText, getByTestId } = renderShell()
    expect(getByText('Review')).toBeInTheDocument()
    expect(getByText('Analysis')).toBeInTheDocument()
    expect(getByTestId('panel')).toBeInTheDocument()
  })

  it('renders analysis depth inside the Analysis tab without changing its accessible name', () => {
    renderAnalysisShell()
    const analysisTab = screen.getByRole('link', { name: 'Analysis', exact: true })
    const badge = screen.getByTestId('depth-badge')
    expect(analysisTab).toContainElement(badge)
    expect(badge).toHaveTextContent('D18')
    expect(badge).toHaveAttribute('title', 'Analysis depth 18')
  })

  it('preserves the raw date anchor when switching tabs', () => {
    renderShell('/alice/games/1/review?source=lichess&before=not-valid')
    expect(screen.getByRole('link', { name: 'Analysis', exact: true })).toHaveAttribute(
      'href', '/alice/games/1/analyze?source=lichess&before=not-valid&move=0',
    )
  })

})
