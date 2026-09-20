import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode } from 'react'
import { render, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SettingsProvider } from '../settings'
import * as analyzer from '../api/analyzer'
import type { ReviewSnapshot } from '../api/analyzer'
import type { MoveReview, ReviewSummary } from '../api/review'
import type { Game } from '../api/types'
import GameShell from './GameShell'
import ReviewPanel from './ReviewPanel'

vi.mock('../api/analyzer', () => ({
  createReview: vi.fn(),
  getReview: vi.fn(),
  cancelReview: vi.fn().mockResolvedValue(undefined),
  // No existing review unless a test overrides hydration.
  listReviews: vi.fn().mockResolvedValue([]),
}))

function game(): Game {
  return {
    source: 'chesscom',
    id: '1',
    white: { username: 'alice', result: 'win', rating: 1500 },
    black: { username: 'bob', result: 'loss', rating: 1400 },
    pgn: '1. e4 e5 *',
    endTime: 0,
    url: 'https://www.chess.com/game/live/1',
  }
}

vi.mock('../hooks/useGame', () => ({
  useGame: () => ({ data: game(), loading: false, error: null }),
}))

vi.mock('../components/Board', () => ({
  default: () => <div data-testid="board" />,
}))

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const reviewedMove: MoveReview = {
  ply: 1, san: 'e4', fenBefore: START,
  evalBefore: 0.2, evalAfterPlayed: 0.1,
  bestMoveSan: 'e4', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
  classification: 'best',
  mateBefore: null, mateAfterPlayed: null,
}
const summary: ReviewSummary = {
  white: { accuracy: 99, counts: { best: 1 }, biggestBlunderPly: null },
  black: { accuracy: 99, counts: {}, biggestBlunderPly: null },
  keyMoments: [], opening: null,
}

function reviewSnapshot(status: ReviewSnapshot['status']): ReviewSnapshot {
  return {
    id: 'job-1', source: 'chesscom', status, white: 'alice', black: 'bob',
    reviewed: status === 'done' ? 1 : 0, totalPlies: 2,
    userId: null, gameId: '1', accuracy: status === 'done' ? 99 : null,
    createdAt: '2026-01-01T00:00:00Z',
    finishedAt: status === 'done' ? '2026-01-01T00:00:01Z' : null,
    depth: 18, multipv: 2, engine: 'Stockfish 19',
    moves: status === 'done' ? [reviewedMove] : [],
    summary: status === 'done' ? summary : null,
    error: null,
  }
}

function fakeDone() {
  vi.mocked(analyzer.createReview).mockResolvedValue({
    id: 'job-1', status: 'queued', engine: null,
  })
  vi.mocked(analyzer.getReview).mockResolvedValue(reviewSnapshot('done'))
}

function fakeRunning() {
  vi.mocked(analyzer.createReview).mockResolvedValue({
    id: 'job-1', status: 'queued', engine: null,
  })
  vi.mocked(analyzer.getReview).mockImplementation(async () => new Promise(() => {}))
}

function LocationProbe() {
  const loc = useLocation()
  return (
    <>
      <div data-testid="loc">{loc.pathname}</div>
      <div data-testid="search">{loc.search}</div>
    </>
  )
}

function renderApp(initialEntry = '/alice/games/1/review') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SettingsProvider>
        <LocationProbe />
        <Routes>
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route path="review" element={<ReviewPanel />} />
            <Route path="analyze" element={<div data-testid="analyze">ANALYSIS</div>} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

function clickAria(container: HTMLElement, text: RegExp) {
  const btn = [...container.querySelectorAll('button')].find((b) => text.test(b.getAttribute('aria-label') ?? ''))
  if (!btn) throw new Error(`button matching ${text} not found`)
  fireEvent.click(btn)
}

function clickTab(container: HTMLElement, text: RegExp) {
  const link = [...container.querySelectorAll('a')].find((a) => text.test(a.textContent ?? ''))
  if (!link) throw new Error(`tab matching ${text} not found`)
  fireEvent.click(link)
}

describe('ReviewPanel start / cancel / persistence (in shell)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('waits for an explicit start when hydration finds no review', async () => {
    fakeDone()
    const { getByRole } = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/alice/games/1/review']}>
          <SettingsProvider>
            <Routes>
              <Route path="/:userId/games/:gameId" element={<GameShell />}>
                <Route path="review" element={<ReviewPanel />} />
              </Route>
            </Routes>
          </SettingsProvider>
        </MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() => expect(analyzer.listReviews).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    expect(getByRole('heading', { name: 'Review this game' })).toBeInTheDocument()
    expect(analyzer.createReview).not.toHaveBeenCalled()
  })

  it('Cancel aborts a manually started review and returns without restarting', async () => {
    fakeRunning()
    const { container, getByRole, getByTestId } = renderApp(
      '/alice/games/1/review?source=chesscom&move=1',
    )
    await waitFor(() => getByRole('button', { name: /^start review$/i }))
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /^start review$/i }))
    })
    await waitFor(() => expect(analyzer.createReview).toHaveBeenCalledOnce())

    await act(async () => { clickAria(container, /cancel review/i) })
    expect(getByTestId('loc').textContent).toBe('/alice/games/1/analyze')
    expect(getByTestId('search').textContent).toBe('?source=chesscom&move=1')
    expect(getByTestId('analyze')).toBeInTheDocument()

    // Return to Review → hero; no new job without another click.
    await act(async () => { clickTab(container, /review/i) })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(analyzer.createReview).toHaveBeenCalledOnce()
  })

  it('persists across tab switches — does not re-run when leaving and returning', async () => {
    fakeDone()
    const { container, getByRole } = renderApp()
    await waitFor(() => getByRole('button', { name: /^start review$/i }))
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /^start review$/i }))
    })
    await waitFor(() => expect(analyzer.createReview).toHaveBeenCalledOnce())

    await act(async () => { clickTab(container, /^analysis$/i) })
    await act(async () => { clickTab(container, /^review$/i) })
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(analyzer.createReview).toHaveBeenCalledOnce()
  })

})

describe('ReviewPanel hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('hydrates an existing done job without creating a new one', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValueOnce([{
      id: 'job-hydrated', source: 'chesscom', status: 'done', white: 'alice', black: 'bob',
      reviewed: 2, totalPlies: 2, userId: null, gameId: '1', accuracy: 99,
      createdAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', depth: 20, multipv: 2,
      engine: 'Stockfish 19',
    }])
    vi.mocked(analyzer.getReview).mockResolvedValue({
      ...reviewSnapshot('done'),
      id: 'job-hydrated',
    })
    const { container } = renderApp()
    // waitFor (not a fixed sleep): the hydrate lookup adds an extra async hop
    // before polling starts, so a single fixed-duration sleep budget
    // races the two steps unreliably.
    await waitFor(() => expect(container.textContent).toContain('99.0'))
    expect(analyzer.createReview).not.toHaveBeenCalled()
  })

  it('enables rerun for a nonmatching review and submits selected settings without force', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValueOnce([{
      id: 'job-hydrated', source: 'chesscom', status: 'done', white: 'alice', black: 'bob',
      reviewed: 2, totalPlies: 2, userId: null, gameId: '1', accuracy: 99,
      createdAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', depth: 20, multipv: 2,
      engine: 'Stockfish 19',
    }])
    vi.mocked(analyzer.getReview).mockResolvedValue({
      ...reviewSnapshot('done'),
      id: 'job-hydrated',
    })
    vi.mocked(analyzer.createReview).mockResolvedValue({
      id: 'job-selected', status: 'queued', engine: null,
    })
    const { getByRole } = renderApp()
    const rerun = await waitFor(() => getByRole('button', { name: /re-run review/i }))

    expect(rerun).toBeEnabled()
    await act(async () => { fireEvent.click(rerun) })

    // No eval payload: the browser engine cannot boot under jsdom, so the sweep
    // gives up and the request falls back to a backend search.
    expect(analyzer.createReview).toHaveBeenCalledWith(
      game().pgn, 18, 2,
      expect.objectContaining({ source: 'chesscom', gameId: '1' }),
      undefined,
    )
  })
})
