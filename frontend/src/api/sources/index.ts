import type { GameSource, Source } from '../types'
import { extraSources } from '@private'
import { lichess } from './lichess'
import { pgn } from './pgn'

// Private sources first so the overlay's default tab wins; core's are lichess, pgn.
export const SOURCES: Record<string, GameSource> = { ...extraSources, lichess, pgn }
export const DEFAULT_SOURCE: Source = Object.keys(SOURCES)[0]

export function getSource(source: Source): GameSource {
  return SOURCES[source] ?? SOURCES[DEFAULT_SOURCE]
}

// Narrow an arbitrary string (e.g. from a query param) to a registered Source,
// defaulting to the first one.
export function asSource(value: string | null | undefined): Source {
  return value && value in SOURCES ? value : DEFAULT_SOURCE
}
