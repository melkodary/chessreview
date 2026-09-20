import { useState, useCallback, useEffect } from 'react'
import { listReviews } from '../api/analyzer'
import type { ReviewInboxItem } from '../api/analyzer'
import { useFetch } from './useFetch'
import { REVIEW_ACTIVE_POLL_MS } from '../config'

interface UseReviewQueue {
  reviews: ReviewInboxItem[]
  loaded: boolean
  loading: boolean
  error: string
  refetch: () => void
}

interface Options {
  // Poll while any review is queued/running, then stop once all are terminal.
  // Off by default (HomePage uses the manual refresh button).
  pollWhileActive?: boolean
  // Scope the inbox fetch to a source/user — an unscoped call still returns
  // everything (GET /reviews with no query params).
  source?: string
  userId?: string
}

// A refetch that returns the same inbox keeps the previous array reference, so
// an unchanged refresh doesn't re-render the queue or its rows.
const sameInbox = (a: ReviewInboxItem[], b: ReviewInboxItem[]) =>
  JSON.stringify(a) === JSON.stringify(b)

const isActive = (r: ReviewInboxItem) => r.status === 'queued' || r.status === 'running'

export function useReviewQueue(
  { pollWhileActive = false, source, userId }: Options = {},
): UseReviewQueue {
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  const { data, loading, error } = useFetch(
    () => listReviews(source, userId),
    [tick, source, userId],
    { isEqual: sameInbox },
  )
  const reviews = data ?? []
  const hasActive = reviews.some(isActive)

  // Re-armed after each fetch (tick) while something is in flight; the effect
  // early-returns the moment nothing is active, so polling self-stops.
  useEffect(() => {
    if (!pollWhileActive || !hasActive) return
    const id = setTimeout(refetch, REVIEW_ACTIVE_POLL_MS)
    return () => clearTimeout(id)
  }, [pollWhileActive, hasActive, tick, refetch])

  // `loaded` flips false→true once (first fetch completes) then stays constant,
  // so it never churns ReviewQueue's props on a refetch.
  return { reviews, loaded: data !== null, loading, error: error ?? '', refetch }
}
