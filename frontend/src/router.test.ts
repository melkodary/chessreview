import { describe, it, expect } from 'vitest'
import { extractGameId, routes } from './router'

describe('extractGameId', () => {
  it('pulls trailing digits from a game URL', () => {
    expect(extractGameId('https://lichess.org/123456789')).toBe('123456789')
  })

  it('pulls trailing digits from daily URL', () => {
    expect(extractGameId('https://lichess.org/98765')).toBe('98765')
  })

  it('handles trailing slash', () => {
    expect(extractGameId('https://lichess.org/42/')).toBe('42')
  })

  it('returns input when no digits found', () => {
    expect(extractGameId('https://example.com/no-id')).toBe('https://example.com/no-id')
  })
})

describe('routes', () => {
  it('games puts userId in path, source always explicit', () => {
    expect(routes.games('lichess', 'alice')).toBe('/alice/games?source=lichess')
    expect(routes.games('lichess', 'a b/c')).toBe('/a%20b%2Fc/games?source=lichess')
  })

  it('non-default source rides as ?source', () => {
    expect(routes.games('lichess', 'alice')).toBe('/alice/games?source=lichess')
    expect(routes.analyze('lichess', 'alice', '123')).toBe('/alice/games/123/analyze?source=lichess')
  })

  it('review nests under /:userId/games/:gameId', () => {
    expect(routes.review('lichess', 'alice', '123')).toBe('/alice/games/123/review?source=lichess')
  })

  it('review appends &move=N when provided', () => {
    expect(routes.review('lichess', 'alice', '123', 5)).toBe('/alice/games/123/review?source=lichess&move=5')
  })

  it('analyze nests under /:userId/games/:gameId', () => {
    expect(routes.analyze('lichess', 'alice', '123')).toBe('/alice/games/123/analyze?source=lichess')
  })

  it('analyze appends &move=N when provided', () => {
    expect(routes.analyze('lichess', 'alice', '123', 3)).toBe('/alice/games/123/analyze?source=lichess&move=3')
  })

  it('merges source and move into one query string', () => {
    expect(routes.analyze('lichess', 'alice', '123', 3))
      .toBe('/alice/games/123/analyze?source=lichess&move=3')
  })

  it('keeps date context in canonical source, before, move order', () => {
    expect(routes.games('lichess', 'alice', '2026-09-01'))
      .toBe('/alice/games?source=lichess&before=2026-09-01')
    expect(routes.analyze('lichess', 'alice', '123', 3, '2026-09-01'))
      .toBe('/alice/games/123/analyze?source=lichess&before=2026-09-01&move=3')
    expect(routes.review('lichess', 'alice', '123', undefined, '2026-09-01'))
      .toBe('/alice/games/123/review?source=lichess&before=2026-09-01')
  })

  it('game returns the shell base path', () => {
    expect(routes.game('lichess', 'alice', '123')).toBe('/alice/games/123?source=lichess')
    expect(routes.game('lichess', 'a b', 'x/y')).toBe('/a%20b/games/x%2Fy?source=lichess')
  })

  it('reviews with no params returns the bare path', () => {
    expect(routes.reviews()).toBe('/reviews')
  })

  it('reviews scopes by source and/or userId', () => {
    expect(routes.reviews('lichess')).toBe('/reviews?source=lichess')
    expect(routes.reviews(undefined, 'alice')).toBe('/reviews?user_id=alice')
    expect(routes.reviews('lichess', 'alice')).toBe('/reviews?source=lichess&user_id=alice')
  })
})
