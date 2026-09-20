import { describe, it, expect, vi, afterEach } from 'vitest'
import { chesscom } from './chesscom'

// Match a fetch URL against the first substring key that appears in it.
function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404 } as unknown as Response
    return { ok: true, status: 200, json: async () => routes[key] } as unknown as Response
  })
}

const raw = (over = {}) => ({
  white: { username: 'alice', result: 'win', rating: 1500 },
  black: { username: 'bob', result: 'checkmated', rating: 1480 },
  pgn: '1. e4 *',
  end_time: 1700000000,
  url: 'https://www.chess.com/game/live/123',
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('chesscom adapter', () => {
  it('maps an archive game to the normalized Game', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/games/archives': { archives: ['https://api.chess.com/pub/player/alice/games/2026/06'] },
      '2026/06': { games: [raw()] },
    }))
    const games = await chesscom.listRecent('alice', 10)
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      source: 'chesscom',
      id: '123',
      white: { username: 'alice', result: 'win' },
      black: { username: 'bob', result: 'loss' },
      endTime: 1700000000,
      url: 'https://www.chess.com/game/live/123',
    })
  })

  it('normalizes draw results', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/games/archives': { archives: ['https://api.chess.com/pub/player/a/games/2026/06'] },
      '2026/06': { games: [raw({
        white: { username: 'a', result: 'agreed' },
        black: { username: 'b', result: 'agreed' },
      })] },
    }))
    const [g] = await chesscom.listRecent('a', 10)
    expect(g.white.result).toBe('draw')
    expect(g.black.result).toBe('draw')
  })

  it('stops at the requested limit across archives', async () => {
    const many = Array.from({ length: 5 }, (_, i) => raw({ url: `https://chess.com/game/${i}` }))
    vi.stubGlobal('fetch', mockFetch({
      '/games/archives': { archives: ['https://api.chess.com/pub/player/a/games/2026/06'] },
      '2026/06': { games: many },
    }))
    const games = await chesscom.listRecent('a', 3)
    expect(games).toHaveLength(3)
  })

  it('starts at the cutoff month, filters exact timestamps, and walks backward serially', async () => {
    const cutoff = Date.UTC(2026, 5, 1, 12)
    const fetch = mockFetch({
      '/games/archives': { archives: [
        'https://api.chess.com/pub/player/a/games/2026/04',
        'https://api.chess.com/pub/player/a/games/2026/05',
        'https://api.chess.com/pub/player/a/games/2026/06',
        'https://api.chess.com/pub/player/a/games/2026/07',
      ] },
      '2026/06': { games: [
        raw({ end_time: cutoff / 1000, url: 'https://chess.com/game/June-eligible' }),
        raw({ end_time: cutoff / 1000 + 1, url: 'https://chess.com/game/June-too-new' }),
      ] },
      '2026/05': { games: [raw({ end_time: cutoff / 1000 - 1, url: 'https://chess.com/game/May' })] },
      '2026/04': { games: [raw({ end_time: cutoff / 1000 - 2, url: 'https://chess.com/game/April' })] },
    })
    vi.stubGlobal('fetch', fetch)

    const games = await chesscom.listRecent('a', 2, cutoff)

    expect(games.map((game) => game.url)).toEqual([
      'https://chess.com/game/June-eligible', 'https://chess.com/game/May',
    ])
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://api.chess.com/pub/player/a/games/2026/07',
    )
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://api.chess.com/pub/player/a/games/2026/04',
    )
  })
})
