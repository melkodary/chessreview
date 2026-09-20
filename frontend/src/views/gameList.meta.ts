import type { Game } from '../api/types'
import type { Classification } from '../api/review'

export type GameResult = 'W' | 'D' | 'L'

interface GameMeta {
  opponent: string
  result: GameResult
  dateLabel: string
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export function formatGameDate(endTime: number, now = new Date()): string {
  const date = new Date(endTime * 1000)
  if (isSameLocalDay(date, now)) return 'Today'

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return isSameLocalDay(date, yesterday) ? 'Yesterday' : date.toLocaleDateString()
}

// Derive the viewer's-perspective summary of a game (opponent, W/D/L, date label).
export function parseGameMeta(game: Game, myUsername: string): GameMeta {
  const isWhite = game.white.username.toLowerCase() === myUsername.toLowerCase()
  const mine = isWhite ? game.white : game.black
  const opponent = isWhite ? game.black.username : game.white.username
  const result: GameResult = mine.result === 'win' ? 'W' : mine.result === 'draw' ? 'D' : 'L'
  return { opponent, result, dateLabel: formatGameDate(game.endTime) }
}

// Fixed product priority for the list's highlight line — notable first, routine
// last; `forced` is not eligible (absent from the scoreboard too).
export const HIGHLIGHT_PRIORITY: Classification[] = [
  'brilliant', 'great', 'blunder', 'miss', 'mistake',
  'inaccuracy', 'best', 'excellent', 'good', 'book',
]

export const HIGHLIGHT_LIMIT = 3

// The first three non-zero counts in priority order; fewer when fewer occurred.
export function reviewHighlights(
  counts: Partial<Record<Classification, number>>,
): { classification: Classification; count: number }[] {
  return HIGHLIGHT_PRIORITY
    .flatMap((c) => (counts[c] ? [{ classification: c, count: counts[c] }] : []))
    .slice(0, HIGHLIGHT_LIMIT)
}
