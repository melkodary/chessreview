import type { Source } from './api/types'

export function extractGameId(url: string): string {
  const m = url.match(/(\d+)\/?$/)
  return m ? m[1] : url
}

const enc = encodeURIComponent

// Merge route context into a query string. Source is
// always explicit, even for the default, so the URI is unambiguous.
function query(source: Source, before?: string, move?: number): string {
  const p = new URLSearchParams()
  p.set('source', source)
  if (before) p.set('before', before)
  if (move != null) p.set('move', String(move))
  return `?${p.toString()}`
}

const gameBase = (userId: string, gameId: string) =>
  `/${enc(userId)}/games/${enc(gameId)}`

export const routes = {
  games: (source: Source, userId: string, before?: string) =>
    `/${enc(userId)}/games${query(source, before)}`,
  game: (source: Source, userId: string, gameId: string, before?: string) =>
    `${gameBase(userId, gameId)}${query(source, before)}`,
  review: (source: Source, userId: string, gameId: string, move?: number, before?: string) =>
    `${gameBase(userId, gameId)}/review${query(source, before, move)}`,
  analyze: (source: Source, userId: string, gameId: string, move?: number, before?: string) =>
    `${gameBase(userId, gameId)}/analyze${query(source, before, move)}`,
  // All params optional (unlike the routes above) — an unscoped GET /reviews
  // is still valid (returns everything); scoping is opt-in per caller.
  reviews: (source?: string, userId?: string, gameId?: string): string => {
    const p = new URLSearchParams()
    if (source) p.set('source', source)
    if (userId) p.set('user_id', userId)
    if (gameId) p.set('game_id', gameId)
    const qs = p.toString()
    return qs ? `/reviews?${qs}` : '/reviews'
  },
}
