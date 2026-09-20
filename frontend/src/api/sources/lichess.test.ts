import { describe, it, expect, vi, afterEach } from 'vitest'
import { lichess } from './lichess'

afterEach(() => vi.unstubAllGlobals())

const won = {
  id: 'abcd1234',
  players: {
    white: { user: { name: 'alice' }, rating: 1600 },
    black: { user: { name: 'bob' }, rating: 1550 },
  },
  winner: 'white',
  pgn: '1. e4 *',
  createdAt: 1700000000000,
  lastMoveAt: 1700000300000,
}

const drawn = {
  id: 'efgh5678',
  players: { white: { user: { name: 'carol' } }, black: { user: { name: 'dave' } } },
  pgn: '1. d4 *',
  createdAt: 1699999000000,
}

describe('lichess adapter', () => {
  it('maps NDJSON games to normalized Games', async () => {
    const ndjson = `${JSON.stringify(won)}\n${JSON.stringify(drawn)}\n`
    vi.stubGlobal('fetch', vi.fn(async () => (
      { ok: true, status: 200, text: async () => ndjson } as unknown as Response
    )))
    const games = await lichess.listRecent('alice', 10)
    expect(games).toHaveLength(2)
    expect(games[0]).toMatchObject({
      source: 'lichess',
      id: 'abcd1234',
      white: { username: 'alice', result: 'win', rating: 1600 },
      black: { username: 'bob', result: 'loss' },
      endTime: 1700000300, // lastMoveAt ms → s
    })
    expect(games[0].url).toContain('/abcd1234')
    // no winner → both draw; endTime falls back to createdAt
    expect(games[1].white.result).toBe('draw')
    expect(games[1].black.result).toBe('draw')
    expect(games[1].endTime).toBe(1699999000)
  })

  it('adds an optional inclusive cutoff without changing latest requests', async () => {
    const fetch = vi.fn(async () => (
      { ok: true, status: 200, text: async () => '' } as unknown as Response
    ))
    vi.stubGlobal('fetch', fetch)

    await lichess.listRecent('alice', 10)
    await lichess.listRecent('alice', 20, 1788307199999)

    expect(String(fetch.mock.calls[0][0])).not.toContain('until=')
    expect(String(fetch.mock.calls[1][0])).toContain('until=1788307199999')
  })

  it('fetchGame maps a single exported game', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      { ok: true, status: 200, json: async () => ({ ...won, winner: 'black' }) } as unknown as Response
    )))
    const game = await lichess.fetchGame('alice', 'abcd1234')
    expect(game).toMatchObject({
      source: 'lichess',
      id: 'abcd1234',
      white: { result: 'loss' },
      black: { result: 'win' },
    })
  })

  it('fetchGame returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 } as unknown as Response)))
    expect(await lichess.fetchGame('x', 'y')).toBeNull()
  })
})
