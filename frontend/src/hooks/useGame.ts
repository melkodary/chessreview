import { getSource } from '../api/sources'
import type { Source } from '../api/types'
import { useFetch } from './useFetch'

export function useGame(source: Source, userId: string, gameId: string) {
  return useFetch(
    async () => {
      const g = await getSource(source).fetchGame(userId, gameId)
      if (!g) throw new Error(`Game ${gameId} not found`)
      return g
    },
    [source, userId, gameId],
  )
}
