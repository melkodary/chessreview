import { CHESSCOM_API_BASE as BASE, MAX_ARCHIVES } from '../../config'
import { extractGameId } from '../../router'
import type { Game, GameSource, Player } from '../types'

// Raw chess.com monthly-archive game shape (only the fields we use).
interface RawGame {
  white: { username: string; result: string; rating?: number }
  black: { username: string; result: string; rating?: number }
  pgn: string
  end_time: number
  url: string
}

const DRAW_RESULTS = new Set([
  'agreed', 'stalemate', 'repetition', 'insufficient', '50move', 'timevsinsufficient',
])

// chess.com encodes the per-side outcome in many strings; only 'win' is a win and
// a known set are draws — everything else is a loss for that side.
function normalizeResult(raw: string): Player['result'] {
  if (raw === 'win') return 'win'
  if (DRAW_RESULTS.has(raw)) return 'draw'
  return 'loss'
}

function toGame(raw: RawGame): Game {
  const side = (s: RawGame['white']): Player => ({
    username: s.username,
    rating: s.rating,
    result: normalizeResult(s.result),
  })
  return {
    source: 'chesscom',
    id: extractGameId(raw.url),
    white: side(raw.white),
    black: side(raw.black),
    pgn: raw.pgn,
    endTime: raw.end_time,
    url: raw.url,
  }
}

async function fetchArchives(username: string): Promise<string[]> {
  const res = await fetch(`${BASE}/player/${encodeURIComponent(username)}/games/archives`)
  if (res.status === 404) throw new Error('User not found')
  if (!res.ok) throw new Error('Chess.com API error')
  const data = await res.json()
  return (data.archives ?? []) as string[]
}

async function fetchArchiveGames(url: string): Promise<RawGame[]> {
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.games ?? []) as RawGame[]
}

export const chesscom: GameSource = {
  // Walk archives newest-first, taking the most-recent games until `limit`.
  async listRecent(username, limit, until) {
    const cutoffMonth = until == null
      ? undefined
      : Date.UTC(new Date(until).getUTCFullYear(), new Date(until).getUTCMonth())
    const archives = (await fetchArchives(username))
      .filter((url) => {
        if (cutoffMonth == null) return true
        const match = url.match(/\/games\/(\d{4})\/(\d{2})\/?$/)
        return !match || Date.UTC(Number(match[1]), Number(match[2]) - 1) <= cutoffMonth
      })
      .reverse()
    const out: Game[] = []
    for (const url of archives) {
      const games = await fetchArchiveGames(url)
      for (const raw of games.reverse()) {
        if (until != null && raw.end_time * 1000 > until) continue
        out.push(toGame(raw))
        if (out.length >= limit) return out
      }
    }
    return out
  },

  // chess.com has no by-id endpoint; search the most recent archives.
  async fetchGame(username, id) {
    const archives = (await fetchArchives(username)).slice(-MAX_ARCHIVES).reverse()
    for (const url of archives) {
      const games = await fetchArchiveGames(url)
      const found = games.find((g) => extractGameId(g.url) === id)
      if (found) return toGame(found)
    }
    return null
  },
}
