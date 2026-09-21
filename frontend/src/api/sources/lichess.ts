import { LICHESS_API_BASE as BASE } from '../../config'
import type { Game, GameSource, Player } from '../types'

// Raw lichess game shape (subset). `pgn` present when pgnInJson=true.
interface RawGame {
  id: string
  players: {
    white: { user?: { name: string }; rating?: number }
    black: { user?: { name: string }; rating?: number }
  }
  winner?: 'white' | 'black'
  pgn?: string
  createdAt: number
  lastMoveAt?: number
}

function side(p: RawGame['players']['white'], color: 'white' | 'black', winner?: string): Player {
  const result: Player['result'] = winner == null ? 'draw' : winner === color ? 'win' : 'loss'
  return { username: p.user?.name ?? 'Anonymous', rating: p.rating, result }
}

function toGame(raw: RawGame): Game {
  return {
    source: 'lichess',
    id: raw.id,
    white: side(raw.players.white, 'white', raw.winner),
    black: side(raw.players.black, 'black', raw.winner),
    pgn: raw.pgn ?? '',
    endTime: Math.floor((raw.lastMoveAt ?? raw.createdAt) / 1000),
    url: `${BASE}/${raw.id}`,
  }
}

export const lichess: GameSource = {
  label: 'Lichess',
  async listRecent(username, limit, until) {
    const params = new URLSearchParams({
      max: String(limit), pgnInJson: 'true', sort: 'dateDesc', clocks: 'true',
    })
    if (until != null) params.set('until', String(until))
    const url = `${BASE}/api/games/user/${encodeURIComponent(username)}?${params}`
    const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } })
    if (res.status === 404) throw new Error('User not found')
    if (!res.ok) throw new Error('Lichess API error')
    const text = await res.text()
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => toGame(JSON.parse(line) as RawGame))
  },

  // Lichess game ids are global — username is unused.
  async fetchGame(_username, id) {
    const res = await fetch(`${BASE}/game/export/${encodeURIComponent(id)}?pgnInJson=true&clocks=true`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error('Lichess API error')
    return toGame((await res.json()) as RawGame)
  },
}
