import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter, Route, Routes, useLocation, useNavigationType,
} from 'react-router-dom'
import { SettingsProvider } from '../settings'
import GameListPage from './GameListPage'

const { listRecent } = vi.hoisted(() => ({ listRecent: vi.fn() }))
vi.mock('../api/sources', () => ({
  asSource: (v: string | null) => (v === 'lichess' ? 'lichess' : 'chesscom'),
  getSource: () => ({ listRecent, fetchGame: vi.fn() }),
}))

vi.mock('../api/analyzer', () => ({
  listReviews: vi.fn().mockResolvedValue([]),
  createReview: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
}))

const games = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    source: 'chesscom', id: String(i),
    white: { username: 'alice', result: 'win' }, black: { username: 'bob', result: 'loss' },
    pgn: '', endTime: 0, url: `u${i}`,
  }))

const localDateKey = (date = new Date()) => {
  const part = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

const cutoff = new Date(2020, 2, 30).getTime() - 1

function renderAt(path = '/alice/games') {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/:userId/games" element={<GameListPage />} /></Routes>
        <LocationProbe />
      </MemoryRouter>
    </SettingsProvider>,
  )
}

function LocationProbe() {
  const location = useLocation()
  const navigationType = useNavigationType()
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="navigation-type">{navigationType}</output>
    </>
  )
}

beforeEach(() => listRecent.mockReset())

describe('GameListPage date state', () => {
  it('normalizes source and malformed, impossible, today, or future dates with replace', async () => {
    listRecent.mockResolvedValue([])
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    for (const raw of ['nope', '2026-02-31', localDateKey(), localDateKey(tomorrow)]) {
      const view = renderAt(`/alice/games?before=${raw}`)
      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent('/alice/games?source=chesscom')
      })
      expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE')
      view.unmount()
    }
  })

  it('passes the inclusive next-local-midnight cutoff for a valid anchor', async () => {
    listRecent.mockResolvedValue([])
    renderAt('/alice/games?source=lichess&before=2020-03-29')

    await waitFor(() => {
      expect(listRecent).toHaveBeenCalledWith('alice', 10, cutoff)
    })
    expect(screen.getByRole('button', { name: /Through/ })).toBeInTheDocument()
    expect(screen.getByText(/No games found through/)).toBeInTheDocument()
  })

  it('applies a native date selection immediately and drops stale rows while loading', async () => {
    let resolveAnchored!: (value: ReturnType<typeof games>) => void
    listRecent
      .mockResolvedValueOnce(games(10))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAnchored = resolve }))
    renderAt('/alice/games?source=chesscom')
    expect(await screen.findAllByTestId('game-row')).toHaveLength(10)

    fireEvent.change(screen.getByLabelText('Show games through date'), {
      target: { value: '2020-03-29' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/alice/games?source=chesscom&before=2020-03-29',
      )
    })
    expect(screen.queryAllByTestId('game-row')).toHaveLength(0)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    resolveAnchored(games(2))
    expect(await screen.findAllByTestId('game-row')).toHaveLength(2)
  })

  it('resets an anchored list to Latest', async () => {
    listRecent.mockResolvedValue([])
    renderAt('/alice/games?source=chesscom&before=2020-03-29')

    await userEvent.click(await screen.findByRole('button', { name: 'Latest' }))
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/alice/games?source=chesscom')
    })
    expect(screen.getByRole('button', { name: 'Latest ▾' })).toBeInTheDocument()
  })
})

describe('GameListPage paging and failure', () => {
  it('expands manually in unbounded ten-game steps', async () => {
    const observe = vi.fn()
    vi.stubGlobal('IntersectionObserver', vi.fn(() => ({ observe, disconnect: vi.fn() })))
    listRecent.mockImplementation((_u: string, limit: number) => Promise.resolve(games(limit)))
    renderAt('/alice/games?source=chesscom')

    expect(await screen.findAllByTestId('game-row')).toHaveLength(10)
    expect(listRecent).toHaveBeenLastCalledWith('alice', 10, undefined)
    expect(observe).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('load-more'))
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(20))
    await userEvent.click(screen.getByTestId('load-more'))
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(30))
    expect(listRecent).toHaveBeenLastCalledWith('alice', 30, undefined)
  })

  it('keeps loaded rows and disables Load more during the larger request', async () => {
    let resolveMore!: (value: ReturnType<typeof games>) => void
    listRecent
      .mockResolvedValueOnce(games(10))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve }))
    renderAt('/alice/games?source=chesscom')
    expect(await screen.findAllByTestId('game-row')).toHaveLength(10)

    await userEvent.click(screen.getByTestId('load-more'))
    expect(screen.getAllByTestId('game-row')).toHaveLength(10)
    expect(screen.getByTestId('load-more')).toBeDisabled()
    expect(screen.getByTestId('load-more')).toHaveTextContent('Loading…')
    resolveMore(games(14))
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(14))
    expect(screen.queryByTestId('load-more')).toBeNull()
  })

  it('retries without losing the anchor or paging limit', async () => {
    listRecent
      .mockRejectedValueOnce(new Error('Chess.com API error'))
      .mockResolvedValueOnce(games(10))
    renderAt('/alice/games?source=chesscom&before=2020-03-29')

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByTestId('game-row')).toHaveLength(10)
    expect(listRecent).toHaveBeenLastCalledWith('alice', 10, cutoff)
    expect(screen.getByTestId('location')).toHaveTextContent('before=2020-03-29')
  })
})
