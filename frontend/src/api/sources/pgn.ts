import { Chess } from 'chess.js'
import { PGN_GAMES_STORAGE } from '../../storage'
import type { Game, GameSource, Player } from '../types'

// Games the user pasted or uploaded. No server: the list lives in localStorage
// (PGN_GAMES_STORAGE — blocked store reads as empty), newest first, capped.
const CAP = 50
const load = PGN_GAMES_STORAGE.load
const save = (games: Game[]) => PGN_GAMES_STORAGE.save(games.slice(0, CAP))

// Deterministic id: the same PGN re-imported dedups here and finds its existing
// backend review (source/user_id/game_id is the review key).
async function gameId(pgn: string): Promise<string> {
  const bytes = new TextEncoder().encode(pgn.replace(/\s+/g, ' ').trim())
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function player(headers: Record<string, string>, color: 'White' | 'Black', result: string): Player {
  const name = headers[color]
  const rating = Number(headers[`${color}Elo`])
  const won = result === (color === 'White' ? '1-0' : '0-1')
  const lost = result === (color === 'White' ? '0-1' : '1-0')
  return {
    username: name && name !== '?' ? name : color,
    rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
    result: won ? 'win' : lost ? 'loss' : 'draw',
  }
}

// `[Date "2026.06.01"]` (+ Lichess's `[UTCTime "12:00:00"]`) → unix seconds; now if absent/unparseable.
function endTime(headers: Record<string, string>): number {
  const d = headers.Date?.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (!d) return Math.floor(Date.now() / 1000)
  const t = headers.UTCTime?.match(/^(\d{2}):(\d{2}):(\d{2})$/) ?? []
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +(t[1] ?? 0), +(t[2] ?? 0), +(t[3] ?? 0))
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000)
}

async function parseOne(text: string): Promise<Game> {
  const chess = new Chess()
  try {
    chess.loadPgn(text)
  } catch {
    throw new Error('Not a valid PGN')
  }
  const headers = chess.getHeaders()
  const result = headers.Result ?? '*'
  return {
    source: 'pgn',
    id: await gameId(text),
    white: player(headers, 'White', result),
    black: player(headers, 'Black', result),
    pgn: text.trim(),
    endTime: endTime(headers),
    url: '',
  }
}

// Parse every game in `text` (a file may hold several), store them, return
// them in file order. Throws `Not a valid PGN` if any game fails to parse.
export async function importPgn(text: string): Promise<Game[]> {
  const chunks = text.split(/\n(?=\[Event\s)/).map((s) => s.trim()).filter(Boolean)
  if (chunks.length === 0) throw new Error('Not a valid PGN')
  const games = await Promise.all(chunks.map(parseOne))
  const fresh = new Set(games.map((g) => g.id))
  save([...games, ...load().filter((g) => !fresh.has(g.id))])
  return games
}

export const pgn: GameSource = {
  label: 'PGN',
  // Every imported game, whoever played it: the username in the URL only picks
  // the side under review (GameShell matches it against white/black).
  async listRecent(_username, limit, until) {
    return load().filter((g) => until == null || g.endTime * 1000 <= until).slice(0, limit)
  },
  async fetchGame(_username, id) {
    return load().find((g) => g.id === id) ?? null
  },
}
