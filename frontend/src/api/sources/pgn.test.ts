import { describe, it, expect, beforeEach, vi } from 'vitest'
import { importPgn, pgn } from './pgn'
import { STORAGE_KEYS } from '../../storage'

const PGN = `[Event "Rated Blitz game"]
[Site "?"]
[Date "2026.06.01"]
[UTCTime "12:00:00"]
[White "alice"]
[Black "bob"]
[Result "0-1"]
[WhiteElo "1500"]
[BlackElo "?"]

1. e4 e5 2. Nf3 Nc6 0-1`

beforeEach(() => localStorage.clear())

describe('pgn source', () => {
  it('parses headers into a Game with a deterministic id', async () => {
    const [a] = await importPgn(PGN)
    const [b] = await importPgn(`  ${PGN.replace(/\n/g, '\n\n')}  `)
    expect(a.id).toHaveLength(16)
    expect(b.id).toBe(a.id)
    expect(a).toMatchObject({
      source: 'pgn',
      white: { username: 'alice', rating: 1500, result: 'loss' },
      black: { username: 'bob', rating: undefined, result: 'win' },
      endTime: Date.UTC(2026, 5, 1, 12) / 1000,
      url: '',
    })
  })

  it('falls back to White/Black for missing names and to now for a missing date', async () => {
    const before = Math.floor(Date.now() / 1000)
    const [g] = await importPgn('[White "?"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2')
    expect(g.white).toMatchObject({ username: 'White', result: 'draw' })
    expect(g.black).toMatchObject({ username: 'Black', result: 'draw' })
    expect(g.endTime).toBeGreaterThanOrEqual(before)
  })

  it('rejects text that is not a PGN', async () => {
    await expect(importPgn('hello world')).rejects.toThrow('Not a valid PGN')
    await expect(importPgn('   ')).rejects.toThrow('Not a valid PGN')
  })

  it('imports every game in a multi-game file, newest import first, deduped, capped at 50', async () => {
    const many = Array.from({ length: 52 }, (_, i) => `[Event "g${i}"]\n\n1. e4 *`)
    const first = await importPgn(many.slice(0, 2).join('\n\n'))
    expect(first).toHaveLength(2)
    const rest = await importPgn(many.slice(1).join('\n\n'))
    expect(rest).toHaveLength(51)
    const stored = await pgn.listRecent('anyone', 100)
    expect(stored).toHaveLength(50)
    expect(stored.filter((g) => g.id === first[1].id)).toHaveLength(1) // deduped, not duplicated
    expect(stored[0].id).toBe(rest[0].id)
  })

  it('lists with limit/until and fetches by id, ignoring the username', async () => {
    const [old] = await importPgn(PGN)
    const [recent] = await importPgn(PGN.replace('2026.06.01', '2026.07.01'))
    expect(await pgn.listRecent('x', 1)).toEqual([recent])
    expect(await pgn.listRecent('x', 5, Date.UTC(2026, 5, 15))).toEqual([old])
    expect(await pgn.fetchGame('x', old.id)).toEqual(old)
    expect(await pgn.fetchGame('x', 'nope')).toBeNull()
  })

  it('survives blocked or corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEYS.pgnGames, '{not json')
    expect(await pgn.listRecent('x', 5)).toEqual([])
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const [g] = await importPgn(PGN)
    expect(g.white.username).toBe('alice')
    vi.restoreAllMocks()
  })
})
