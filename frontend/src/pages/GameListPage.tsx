import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getSource, asSource } from '../api/sources'
import type { Source } from '../api/types'
import type { Game } from '../api/types'
import { createReview } from '../api/analyzer'
import type { ReviewInboxItem } from '../api/analyzer'
import GameList from '../views/GameList'
import { useFetch } from '../hooks/useFetch'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useReviewQueue } from '../hooks/useReviewQueue'
import { useSettings } from '../settingsContext'
import { routes } from '../router'
import { GAMES_PAGE_SIZE } from '../config'

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function localDateKey(date = new Date()): string {
  const part = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
}

function validBeforeKey(raw: string | null, today = new Date()): string | undefined {
  const match = raw?.match(DATE_KEY)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return localDateKey(date) === raw && raw < localDateKey(today) ? raw : undefined
}

function endOfLocalDay(key: string): number {
  const match = key.match(DATE_KEY)!
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).getTime() - 1
}

function formatBefore(key: string, today: Date): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', ...(year === today.getFullYear() ? {} : { year: 'numeric' }),
  }).format(new Date(year, month - 1, day))
}

export default function GameListPage() {
  const { userId } = useParams() as { userId: string }
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const rawSource = params.get('source')
  const source = asSource(rawSource)
  const rawBefore = params.get('before')
  const today = new Date()
  const todayKey = localDateKey(today)
  const before = validBeforeKey(rawBefore, today)

  useEffect(() => {
    if (rawSource === source && (rawBefore == null || before != null)) return

    const nextParams = new URLSearchParams(params)
    nextParams.set('source', source)
    if (before == null) nextParams.delete('before')
    navigate({ search: `?${nextParams}` }, { replace: true })
  }, [before, navigate, params, rawBefore, rawSource, source])

  useDocumentTitle(userId)
  // Keyed remount resets fetch and paging state when the list context changes.
  return (
    <GameListView
      key={`${source}/${userId}/${before ?? ''}`}
      source={source}
      userId={userId}
      before={before}
      beforeLabel={before ? formatBefore(before, today) : undefined}
      todayKey={todayKey}
    />
  )
}

interface GameListViewProps {
  source: Source
  userId: string
  before?: string
  beforeLabel?: string
  todayKey: string
}

function GameListView({ source, userId, before, beforeLabel, todayKey }: GameListViewProps) {
  const navigate = useNavigate()
  const [limit, setLimit] = useState(GAMES_PAGE_SIZE)
  const [requestKey, setRequestKey] = useState(0)
  const { reviewDepth, reviewMultiPv } = useSettings()
  const { reviews, refetch } = useReviewQueue({ pollWhileActive: true, source, userId })

  const { data: games, loading, error } = useFetch(
    () => getSource(source).listRecent(userId, limit, before ? endOfLocalDay(before) : undefined),
    [source, userId, limit, before, requestKey],
  )

  useEffect(() => { document.documentElement.scrollTop = 0 }, [])

  const canLoadMore = loading ? (games?.length ?? 0) > 0 : (games?.length ?? 0) === limit
  const loadMore = () => setLimit((n) => n + GAMES_PAGE_SIZE)

  // source/userId are already scoped server-side (GET /reviews?source=&user_id=);
  // only gameId still needs a client-side match.
  const reviewFor = (game: Game): ReviewInboxItem | undefined =>
    reviews.find((r) => r.gameId === game.id)

  const onQueueReview = async (game: Game) => {
    await createReview(game.pgn, reviewDepth, reviewMultiPv, {
      source: game.source,
      userId,
      gameId: game.id,
      // Ratings the list already holds — feeds the backend's rating-aware
      // classifier (k(elo)); omitted when the provider didn't supply them.
      whiteElo: game.white.rating,
      blackElo: game.black.rating,
    })
    refetch()
  }

  return (
    <GameList
      username={userId}
      games={games ?? []}
      loading={loading}
      error={error}
      before={before}
      beforeLabel={beforeLabel}
      todayKey={todayKey}
      canLoadMore={canLoadMore}
      onLoadMore={loadMore}
      onRetry={() => setRequestKey((n) => n + 1)}
      onBeforeChange={(value) => navigate(routes.games(
        source, userId, validBeforeKey(value, new Date()),
      ))}
      onSelect={(g) => navigate(routes.analyze(source, userId, g.id, undefined, before))}
      reviewFor={reviewFor}
      onQueueReview={onQueueReview}
    />
  )
}
