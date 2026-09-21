import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { Chess } from 'chess.js'
import type { ReactElement } from 'react'
import { SettingsProvider } from '../settings'
import GameShell from './GameShell'
import type { Game } from '../api/types'

vi.mock('../api/analyzer', () => ({
  createReview: vi.fn().mockResolvedValue({ id: 'job-1', status: 'queued' }),
  getReview: vi.fn().mockImplementation(() => new Promise(() => {})),
  cancelReview: vi.fn().mockResolvedValue(undefined),
  listReviews: vi.fn().mockResolvedValue([]),
}))

// Game line opens 1.d4 — distinct from the 1.e4 we explore, so a game-nav fen
// and a branch fen are never confused.
const PGN = `[Event "T"]
[White "alice"]
[Black "bob"]
[Result "*"]

1. d4 d5 2. c4 *`

function fakeGame(): Game {
  return {
    source: 'lichess',
    id: '1',
    white: { username: 'alice', result: 'win', rating: 1500 },
    black: { username: 'bob', result: 'loss', rating: 1400 },
    pgn: PGN,
    endTime: 0,
    url: 'https://lichess.org/1',
  }
}

vi.mock('../hooks/useGame', () => ({
  useGame: () => ({ data: fakeGame(), loading: false, error: null }),
}))

// Capture the props GameShell hands the board; render the fen for assertions.
type BoardProps = {
  fen: string
  onPieceDrop?: (a: { sourceSquare: string; targetSquare: string | null }) => boolean
}
let boardProps: BoardProps = { fen: '' }
vi.mock('../components/Board', () => ({
  default: (props: BoardProps) => {
    boardProps = props
    return <div data-testid="board" data-fen={props.fen} />
  },
}))

const START = new Chess().fen()
function afterMoves(...sans: string[]): string {
  const c = new Chess()
  for (const s of sans) c.move(s)
  return c.fen()
}

function LocationProbe() {
  const loc = useLocation()
  const navigationType = useNavigationType()
  return (
    <>
      <div data-testid="loc">{loc.pathname}</div>
      <div data-testid="search">{loc.search}</div>
      <div data-testid="navigation-type">{navigationType}</div>
    </>
  )
}

function renderShell(
  tab: 'review' | 'analyze',
  analyzeEl: ReactElement = <div data-testid="panel" />,
  search = '',
) {
  return render(
    <MemoryRouter initialEntries={[`/alice/games/1/${tab}${search}`]}>
      <SettingsProvider>
        <LocationProbe />
        <Routes>
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route path="review" element={<div data-testid="panel" />} />
            <Route path="analyze" element={analyzeEl} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

function clickTab(container: HTMLElement, text: RegExp) {
  const link = [...container.querySelectorAll('a')].find((a) => text.test(a.textContent ?? ''))
  if (!link) throw new Error(`tab matching ${text} not found`)
  fireEvent.click(link)
}

describe('GameShell exploration wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    boardProps = { fen: '' }
  })

  it('a legal drop on the Review board seeds the branch and stays on Review', () => {
    const { getByTestId } = renderShell('review')
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    // No tab switch: deviation is graded in place on Review.
    expect(getByTestId('loc').textContent).toBe('/alice/games/1/review')
    // The explored fen flows to the board.
    expect(boardProps.fen).toBe(afterMoves('e4'))
  })

  it('a branch seeded on Analysis is discarded on the flip to Review', () => {
    const { container } = renderShell('analyze')
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    expect(boardProps.fen).toBe(afterMoves('e4'))
    act(() => { clickTab(container, /^review$/i) })
    // Analysis is a scratchpad: Review restores what *it* last saw, which here
    // is no branch at all. Plies wandered on Analysis never arrive graded.
    expect(boardProps.fen).toBe(START)
  })

  it('a branch seeded on Review survives the flip to Analysis', () => {
    const { container } = renderShell('review')
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { clickTab(container, /^analysis$/i) })
    expect(boardProps.fen).toBe(afterMoves('e4'))
  })

  it('round trip: Review branch comes back, Analysis plies do not', () => {
    const { container } = renderShell('review')
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { clickTab(container, /^analysis$/i) })
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    expect(boardProps.fen).toBe(afterMoves('e4', 'e5'))
    act(() => { clickTab(container, /^review$/i) })
    expect(boardProps.fen).toBe(afterMoves('e4'))
  })

  it('a legal drop flows the explored fen to the board', () => {
    renderShell('analyze')
    expect(boardProps.fen).toBe(START)
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    expect(boardProps.fen).toBe(afterMoves('e4'))
  })

  it('arrow keys navigate the GAME line when not exploring', () => {
    renderShell('analyze')
    act(() => { press('ArrowRight') })
    expect(boardProps.fen).toBe(afterMoves('d4')) // game move, not the explored e4
  })

  it('mainline navigation replaces move in the URI and preserves other query params', async () => {
    const { getByTestId } = renderShell(
      'analyze',
      <div data-testid="panel" />,
      '?source=lichess&move=1&foo=keep',
    )

    act(() => { press('ArrowRight') })

    await waitFor(() => {
      expect(getByTestId('search').textContent).toBe('?source=lichess&move=2&foo=keep')
    })
    expect(getByTestId('navigation-type').textContent).toBe('REPLACE')
  })

  it.each([
    ['', '?move=0'],
    ['?move=oops', '?move=0'],
    ['?move=-3', '?move=0'],
    ['?move=2.9', '?move=2'],
    ['?move=99', '?move=3'],
  ])('canonicalizes %s after the game loads', async (search, expected) => {
    const { getByTestId } = renderShell('analyze', <div data-testid="panel" />, search)
    await waitFor(() => {
      expect(getByTestId('search').textContent).toBe(expected)
    })
  })

  it('tab links preserve the current mainline move', async () => {
    const { container, getByTestId } = renderShell(
      'review',
      <div data-testid="panel" />,
      '?source=lichess&move=2',
    )

    act(() => { clickTab(container, /^analysis$/i) })

    await waitFor(() => {
      expect(getByTestId('search').textContent).toBe('?source=lichess&move=2')
    })
  })

  it('branch navigation leaves the URI at the canonical fork ply', async () => {
    const { getByTestId } = renderShell(
      'analyze',
      <div data-testid="panel" />,
      '?move=1.9',
    )
    await waitFor(() => {
      expect(getByTestId('search').textContent).toBe('?move=1')
    })

    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    act(() => { press('ArrowLeft') })

    expect(getByTestId('search').textContent).toBe('?move=1')
  })

  it('arrow keys navigate the BRANCH when exploring', () => {
    renderShell('analyze')
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e2', targetSquare: 'e4' }) })
    act(() => { boardProps.onPieceDrop!({ sourceSquare: 'e7', targetSquare: 'e5' }) })
    expect(boardProps.fen).toBe(afterMoves('e4', 'e5'))
    act(() => { press('ArrowLeft') }) // branch back → after e4
    expect(boardProps.fen).toBe(afterMoves('e4'))
    act(() => { press('ArrowLeft') }) // → fork (game start)
    expect(boardProps.fen).toBe(START)
  })

})
