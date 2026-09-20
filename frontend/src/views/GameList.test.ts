import { describe, it, expect } from 'vitest'
import { formatGameDate, parseGameMeta, reviewHighlights } from './gameList.meta'
import type { Game } from '../api/types'

const makeGame = (overrides: Partial<Game> = {}): Game => ({
  source: 'chesscom',
  id: '1',
  white: { username: 'alice', result: 'win', rating: 1500 },
  black: { username: 'bob', result: 'loss', rating: 1480 },
  pgn: '',
  endTime: 1700000000,
  url: 'https://chess.com/game/1',
  ...overrides,
})

describe('parseGameMeta', () => {
  it('marks W when user is white and won', () => {
    const meta = parseGameMeta(makeGame(), 'alice')
    expect(meta.result).toBe('W')
    expect(meta.opponent).toBe('bob')
  })

  it('marks L when user is white and lost', () => {
    const meta = parseGameMeta(
      makeGame({
        white: { username: 'alice', result: 'loss' },
        black: { username: 'bob', result: 'win' },
      }),
      'alice',
    )
    expect(meta.result).toBe('L')
  })

  it('marks W when user is black and won', () => {
    const meta = parseGameMeta(
      makeGame({
        white: { username: 'alice', result: 'loss' },
        black: { username: 'bob', result: 'win' },
      }),
      'bob',
    )
    expect(meta.result).toBe('W')
    expect(meta.opponent).toBe('alice')
  })

  it('marks D for a draw', () => {
    const meta = parseGameMeta(
      makeGame({
        white: { username: 'alice', result: 'draw' },
        black: { username: 'bob', result: 'draw' },
      }),
      'alice',
    )
    expect(meta.result).toBe('D')
  })

  it('matches username case-insensitively', () => {
    const meta = parseGameMeta(makeGame(), 'ALICE')
    expect(meta.result).toBe('W')
    expect(meta.opponent).toBe('bob')
  })
})

describe('formatGameDate', () => {
  const now = new Date(2026, 0, 1, 12)
  const timestamp = (date: Date) => date.getTime() / 1000

  it('labels today and yesterday across a year boundary', () => {
    expect(formatGameDate(timestamp(new Date(2026, 0, 1, 1)), now)).toBe('Today')
    expect(formatGameDate(timestamp(new Date(2025, 11, 31, 23)), now)).toBe('Yesterday')
  })

  it('uses the locale calendar date for older games', () => {
    const older = new Date(2025, 11, 30, 12)
    expect(formatGameDate(timestamp(older), now)).toBe(older.toLocaleDateString())
  })
})

describe('reviewHighlights', () => {
  it('takes the first three non-zero counts in priority order, skipping zeroes', () => {
    expect(reviewHighlights({
      book: 4, best: 10, good: 3, inaccuracy: 2, mistake: 0, blunder: 1, great: 0,
    })).toEqual([
      { classification: 'blunder', count: 1 },
      { classification: 'inaccuracy', count: 2 },
      { classification: 'best', count: 10 },
    ])
  })

  it('renders fewer than three when fewer occurred and ignores forced', () => {
    expect(reviewHighlights({ forced: 2, brilliant: 1 })).toEqual([
      { classification: 'brilliant', count: 1 },
    ])
    expect(reviewHighlights({})).toEqual([])
  })
})
