import type { GameSource, Source } from '../types'
import { chesscom } from './chesscom'
import { lichess } from './lichess'

const SOURCES: Record<Source, GameSource> = { chesscom, lichess }

export function getSource(source: Source): GameSource {
  return SOURCES[source]
}

// Narrow an arbitrary string (e.g. from a query param) to a known Source,
// defaulting to chesscom.
export function asSource(value: string | null | undefined): Source {
  return value === 'lichess' ? 'lichess' : 'chesscom'
}
