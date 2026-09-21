import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  listReviews: vi.fn().mockResolvedValue([]),
}))

function game(): Game {
  return {
    source: 'lichess',
    id: '1',
    white: { username: 'alice', result: 'win', rating: 1500 },
    black: { username: 'bob', result: 'loss', rating: 1400 },
    pgn: '1. e4 e5 *',
    endTime: 0,
    url: 'https://lichess.org/1',
  }
}

vi.mock('../hooks/useGame', () => ({
  useGame: () => ({ data: game(), loading: false, error: null }),
}))

// Stub the heavy board; surface arrows + badge (set via shell overlay) for assertions.
vi.mock('../components/Board', () => ({
  default: ({ arrows, badge }: { arrows?: unknown[]; badge?: { square: string; classification: string } }) => (
    <div
      data-testid="board"
      data-arrows={arrows?.length ?? 0}
      data-badge={badge ? `${badge.square}-${badge.classification}` : ''}
    />
  ),
}))

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const reviewedMove: MoveReview = {
  ply: 1, san: 'e4', fenBefore: START,
  evalBefore: 0.2, evalAfterPlayed: -3.96,
  bestMoveSan: 'd4', winBefore: 50, winAfterPlayed: 10, winDrop: 40,
  classification: 'blunder',
  mateBefore: null, mateAfterPlayed: null,
}
const summary: ReviewSummary = {
  white: { accuracy: 50, counts: { blunder: 1 }, biggestBlunderPly: 1 },
  black: { accuracy: 100, counts: {}, biggestBlunderPly: null },
  keyMoments: [1], opening: null,
}

function fakeDone() {
  vi.mocked(analyzer.createReview).mockResolvedValue({ id: 'job-1', status: 'queued' })
  vi.mocked(analyzer.getReview).mockResolvedValue({
    id: 'job-1', source: 'lichess', status: 'done',
    white: 'alice', black: 'bob', reviewed: 1, totalPlies: 2,
    userId: null, gameId: '1', accuracy: 50,
    createdAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z',
    depth: 18, multipv: 2, engine: 'Stockfish 19',
    moves: [reviewedMove], summary, error: null,
  } satisfies ReviewSnapshot)
}

function renderAt(move: number) {
  return render(
    <MemoryRouter initialEntries={[`/alice/games/1/review?move=${move}`]}>
      <SettingsProvider>
        <Routes>
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route path="review" element={<ReviewPanel />} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

async function runReview(container: HTMLElement) {
  await waitFor(() => {
    const start = [...container.querySelectorAll('button')]
      .find((button) => /^start review$/i.test(button.textContent ?? ''))
    if (!start) throw new Error('manual start not ready')
    fireEvent.click(start)
  })
  await waitFor(() => expect(container.textContent).toContain('50.0'))
}

function clickText(container: HTMLElement, text: RegExp) {
  const btn = [...container.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))
  if (!btn) throw new Error(`button matching ${text} not found`)
  fireEvent.click(btn)
}

describe('ReviewPanel two-screen flow (in shell)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('Start Review enters the walkthrough — coach bubble + board arrows + badge', async () => {
    fakeDone()
    const { container, getByText } = renderAt(1)
    await runReview(container)
    await act(async () => { clickText(container, /Start Review/i) })
    expect(getByText('e4 is a blunder — best was d4')).toBeInTheDocument()
    const board = container.querySelector('[data-testid="board"]') as HTMLElement
    expect(Number(board.dataset.arrows)).toBe(1) // best move only
    expect(board.dataset.badge).toBe('e4-blunder')
  })

  it('back arrow returns from walkthrough to the summary screen', async () => {
    fakeDone()
    const { container, queryByText } = renderAt(1)
    await runReview(container)
    await act(async () => { clickText(container, /Start Review/i) })
    expect(queryByText('e4 is a blunder — best was d4')).not.toBeNull()
    await act(async () => { clickText(container, /Summary/i) })
    expect(queryByText('e4 is a blunder — best was d4')).toBeNull()
    expect(queryByText(/Start Review/i)).not.toBeNull()
  })

})
