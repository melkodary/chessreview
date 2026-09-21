/* eslint-disable react-refresh/only-export-components, @typescript-eslint/no-unused-vars -- barrel stub */
// Drop-in for `src/private/` when the overlay is absent (vite.config.ts picks
// it automatically): same exports, nothing rendered, no extra game sources.
import type { ReactNode } from 'react'
import type { ExplainMoveRequest } from '../api/review'
import type { GameSource } from '../api/types'

export const extraSources: Record<string, GameSource> = {}

export function StatsMenu(): ReactNode {
  return null
}

export function useMoveExplanation(_: {
  initialRequest?: ExplainMoveRequest
  regradeRequest?: ExplainMoveRequest
}): { open: (() => void) | undefined; modal: ReactNode } {
  return { open: undefined, modal: null }
}
