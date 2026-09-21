import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import * as analyzer from '../api/analyzer'
import type { ReviewInboxItem } from '../api/analyzer'
import { useReviewQueue } from './useReviewQueue'

vi.mock('../api/analyzer', () => ({
  listReviews: vi.fn(),
  cancelReview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../config', () => ({ REVIEW_ACTIVE_POLL_MS: 20 }))

function item(id = 'j', status: ReviewInboxItem['status'] = 'done'): ReviewInboxItem {
  return {
    id, source: 'lichess', status,
    white: 'a', black: 'b', reviewed: 2, totalPlies: 2,
    userId: 'a', gameId: '1', accuracy: 90,
    createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('useReviewQueue', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('fetches on mount and returns reviews', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValue([item('a'), item('b')])
    const { result } = renderHook(() => useReviewQueue())
    await waitFor(() => expect(result.current.reviews).toHaveLength(2))
    expect(analyzer.listReviews).toHaveBeenCalledTimes(1)
  })

  it('surfaces errors', async () => {
    vi.mocked(analyzer.listReviews).mockRejectedValue(new Error('net fail'))
    const { result } = renderHook(() => useReviewQueue())
    await waitFor(() => expect(result.current.error).toBe('net fail'))
  })

  it('refetch() triggers a new fetch', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValue([])
    const { result } = renderHook(() => useReviewQueue())
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => { result.current.refetch() })
    await waitFor(() => expect(analyzer.listReviews).toHaveBeenCalledTimes(2))
  })

  it('does not poll by default, even with an active review', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValue([item('a', 'running')])
    renderHook(() => useReviewQueue())
    await waitFor(() => expect(analyzer.listReviews).toHaveBeenCalledTimes(1))
    await wait(60)
    expect(analyzer.listReviews).toHaveBeenCalledTimes(1)
  })

  it('polls while a review is active when pollWhileActive is set', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValue([item('a', 'running')])
    renderHook(() => useReviewQueue({ pollWhileActive: true }))
    await waitFor(() => expect(analyzer.listReviews.mock.calls.length).toBeGreaterThan(2))
  })

  it('stops polling once all reviews reach a terminal state', async () => {
    vi.mocked(analyzer.listReviews)
      .mockResolvedValueOnce([item('a', 'running')])
      .mockResolvedValueOnce([item('a', 'running')])
      .mockResolvedValue([item('a', 'done')])
    const { result } = renderHook(() => useReviewQueue({ pollWhileActive: true }))
    await waitFor(() => expect(result.current.reviews[0]?.status).toBe('done'))
    const settled = analyzer.listReviews.mock.calls.length
    await wait(60)
    expect(analyzer.listReviews.mock.calls.length).toBe(settled)
  })

  it('threads source/userId through to listReviews', async () => {
    vi.mocked(analyzer.listReviews).mockResolvedValue([])
    renderHook(() => useReviewQueue({ source: 'lichess', userId: 'alice' }))
    await waitFor(() => expect(analyzer.listReviews).toHaveBeenCalledWith('lichess', 'alice'))
  })

  afterEach(() => { vi.useRealTimers() })
})
