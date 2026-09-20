import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

import * as analyzer from '../api/analyzer'
import type { ReviewInboxItem, ReviewSnapshot } from '../api/analyzer'
import type { MoveReview, ReviewSummary } from '../api/review'
import { pickReview, useGameReview } from './useGameReview'
import { SettingsProvider } from '../settings'
import { useSettings } from '../settingsContext'
import { REVIEW_ACTIVE_POLL_MS } from '../config'

const PGN = '1. e4 e5 2. Nf3 Nc6 *'  // 4 plies

type HookResult = ReturnType<typeof useGameReview>

function Harness({
  pgn, gameId, onState, onSettings,
}: {
  pgn: string
  gameId?: string
  onState: (s: HookResult) => void
  onSettings: (setDepth: (depth: number) => void, setMultiPv: (multipv: number) => void) => void
}) {
  const state = useGameReview(pgn, gameId ? { gameId } : {})
  const { setReviewDepth, setReviewMultiPv } = useSettings()
  useEffect(() => { onState(state) })
  useEffect(() => { onSettings(setReviewDepth, setReviewMultiPv) }, [onSettings, setReviewDepth, setReviewMultiPv])
  return null
}

function renderHarness(pgn: string, gameId?: string) {
  const states: HookResult[] = []
  const onState = (s: HookResult) => { states.push(s) }
  let setDepth!: (depth: number) => void
  let setMultiPv!: (multipv: number) => void
  const onSettings = (
    nextSetDepth: (depth: number) => void,
    nextSetMultiPv: (multipv: number) => void,
  ) => {
    setDepth = nextSetDepth
    setMultiPv = nextSetMultiPv
  }
  const utils = render(
    <SettingsProvider>
      <Harness pgn={pgn} gameId={gameId} onState={onState} onSettings={onSettings} />
    </SettingsProvider>
  )
  const latest = () => states[states.length - 1]
  const rerender = (next: string) => utils.rerender(
    <SettingsProvider>
      <Harness pgn={next} gameId={gameId} onState={onState} onSettings={onSettings} />
    </SettingsProvider>
  )
  const changeSettings = (depth: number, multipv: number) => {
    setDepth(depth)
    setMultiPv(multipv)
  }
  return { latest, rerender, changeSettings }
}

function inboxItem(partial: Partial<ReviewInboxItem> & { id: string; status: ReviewInboxItem['status'] }): ReviewInboxItem {
  return {
    source: 'chesscom', white: 'a', black: 'b', reviewed: 0, totalPlies: 4,
    userId: null, gameId: 'game-1', accuracy: null,
    createdAt: '2026-01-01T00:00:00Z', finishedAt: null, depth: 20, multipv: 2,
    engine: null, engineSource: 'backend',
    ...partial,
  }
}

function fakeReview(review: ReviewSnapshot) {
  vi.spyOn(analyzer, 'cancelReview').mockResolvedValue(undefined)
  vi.spyOn(analyzer, 'getReview').mockResolvedValue(review)
  return vi.spyOn(analyzer, 'createReview').mockResolvedValue({
    id: 'job-1', status: 'queued', engine: null,
  })
}

function move(ply: number, classification: MoveReview['classification']): MoveReview {
  return {
    ply, san: 'e4', fenBefore: '...',
    evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: 'e4', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    classification,
    mateBefore: null, mateAfterPlayed: null,
  }
}

const SUMMARY_DATA: ReviewSummary = {
  white: { accuracy: 95, counts: { best: 2 }, biggestBlunderPly: null },
  black: { accuracy: 90, counts: { best: 2 }, biggestBlunderPly: null },
  keyMoments: [],
  opening: null,
}

function snapshot(
  status: ReviewSnapshot['status'],
  partial: Partial<ReviewSnapshot> = {},
): ReviewSnapshot {
  return {
    ...inboxItem({ id: 'job-1', status }),
    status,
    moves: [],
    summary: null,
    error: null,
    ...partial,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('useGameReview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('restart after cancel does not accumulate stale moves', async () => {
    fakeReview(snapshot('running', {
      moves: [move(1, 'best'), move(2, 'best'), move(3, 'best'), move(4, 'best')],
    }))
    const { latest } = renderHarness(PGN)
    await act(async () => { latest().start() })
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    await act(async () => { latest().cancel() })
    await act(async () => { latest().start() })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(latest().moves.length).toBe(4)
  })

  it('start() is a no-op while running', async () => {
    const spy = fakeReview(snapshot('running', { moves: [move(1, 'best')] }))
    const { latest } = renderHarness(PGN)
    await act(async () => { latest().start() })
    await act(async () => { latest().start() })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('surfaces error on create failure', async () => {
    vi.spyOn(analyzer, 'createReview').mockRejectedValue(new Error('boom'))
    const { latest } = renderHarness(PGN)
    await act(async () => { latest().start() })
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(latest().state).toBe('error')
    expect(latest().error).toBe('boom')
  })

})

describe('useGameReview.polling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(analyzer, 'cancelReview').mockResolvedValue(undefined)
    vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-1', status: 'queued', engine: null,
    })
  })

  it('polls serially, applies snapshots, and stops at done', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (row: ReviewSnapshot) => void
    const getSpy = vi.spyOn(analyzer, 'getReview')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(snapshot('done', {
        engine: 'Stockfish 19',
        moves: [move(1, 'best'), move(2, 'best')],
        summary: SUMMARY_DATA,
      }))
    const { latest } = renderHarness(PGN)

    await act(async () => {
      latest().start()
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_ACTIVE_POLL_MS * 3) })
    expect(getSpy).toHaveBeenCalledOnce()

    await act(async () => {
      resolveFirst(snapshot('running', {
        engine: 'Stockfish 19',
        moves: [move(1, 'best')],
      }))
    })
    expect(latest().state).toBe('running')
    expect(latest().moves).toHaveLength(1)
    expect(latest().engine).toBe('Stockfish 19')

    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_ACTIVE_POLL_MS - 1) })
    expect(latest().moves).toHaveLength(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(latest().state).toBe('done')
    expect(latest().moves).toHaveLength(2)
    expect(latest().summary).toEqual(SUMMARY_DATA)

    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_ACTIVE_POLL_MS * 2) })
    expect(getSpy).toHaveBeenCalledTimes(2)
  })

  it('aborts and ignores a stale snapshot after game replacement', async () => {
    let resolve!: (row: ReviewSnapshot) => void
    let requestSignal!: AbortSignal
    vi.spyOn(analyzer, 'getReview').mockImplementation(
      (_id, signal) => {
        requestSignal = signal
        return new Promise((next) => { resolve = next })
      },
    )
    const { latest, rerender } = renderHarness(PGN)

    await act(async () => { latest().start() })
    await waitFor(() => expect(requestSignal).toBeDefined())

    rerender('1. d4 d5 *')
    expect(requestSignal.aborted).toBe(true)

    await act(async () => {
      resolve(snapshot('done', {
        moves: [move(1, 'best')],
        summary: SUMMARY_DATA,
      }))
      await Promise.resolve()
    })
    expect(latest().state).toBe('idle')
    expect(latest().moves).toEqual([])
  })
})

describe('useGameReview.hydrate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('attaches to a running job and receives persisted moves', async () => {
    vi.spyOn(analyzer, 'listReviews').mockResolvedValue([
      inboxItem({ id: 'job-running', status: 'running' }),
    ])
    vi.spyOn(analyzer, 'getReview').mockResolvedValue(
      snapshot('running', { id: 'job-running', moves: [move(1, 'best')] }),
    )
    const { latest } = renderHarness(PGN, 'game-1')
    await waitFor(() => expect(latest().moves.length).toBe(1))
  })

  it.each([
    {
      name: 'matching done before matching live',
      jobs: [
        inboxItem({ id: 'nonmatch-done', status: 'done', depth: 20 }),
        inboxItem({ id: 'match-done', status: 'done', depth: 18 }),
        inboxItem({ id: 'match-live', status: 'running', depth: 18 }),
      ],
      expected: 'match-done',
    },
    {
      name: 'matching live before nonmatching done',
      jobs: [
        inboxItem({ id: 'nonmatch-done', status: 'done', depth: 20 }),
        inboxItem({ id: 'match-live', status: 'queued', depth: 18 }),
      ],
      expected: 'match-live',
    },
    {
      name: 'nonmatching done before nonmatching live',
      jobs: [
        inboxItem({ id: 'ignored-error', status: 'error' }),
        inboxItem({ id: 'fallback-done', status: 'done', depth: 20 }),
        inboxItem({ id: 'fallback-live', status: 'running', depth: 22 }),
      ],
      expected: 'fallback-done',
    },
    {
      name: 'a backend row over a newer frontend row in the same tier',
      jobs: [
        inboxItem({ id: 'newer-frontend', status: 'done', depth: 18, engineSource: 'frontend' }),
        inboxItem({ id: 'older-backend', status: 'done', depth: 18, engineSource: 'backend' }),
      ],
      expected: 'older-backend',
    },
    {
      name: 'a matching frontend-done row over a matching backend-live row (tier wins)',
      jobs: [
        inboxItem({ id: 'match-done-frontend', status: 'done', depth: 18, engineSource: 'frontend' }),
        inboxItem({ id: 'match-live-backend', status: 'running', depth: 18, engineSource: 'backend' }),
      ],
      expected: 'match-done-frontend',
    },
    {
      name: 'newest-first when all rows share a tier and are backend (unchanged)',
      jobs: [
        inboxItem({ id: 'newest-backend', status: 'done', depth: 18, engineSource: 'backend' }),
        inboxItem({ id: 'older-backend-2', status: 'done', depth: 18, engineSource: 'backend' }),
      ],
      expected: 'newest-backend',
    },
  ])('selects $name', ({ jobs, expected }) => {
    expect(pickReview(jobs, { depth: 18, multipv: 2 })?.id).toBe(expected)
  })

  it('selects against settings captured before the hydration request', async () => {
    let resolveList!: (jobs: ReviewInboxItem[]) => void
    vi.spyOn(analyzer, 'listReviews').mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve }),
    )
    const getSpy = vi.spyOn(analyzer, 'getReview').mockResolvedValue(
      snapshot('done', { summary: SUMMARY_DATA }),
    )
    const { latest, changeSettings } = renderHarness(PGN, 'game-1')

    await act(async () => { changeSettings(20, 4) })
    await act(async () => {
      resolveList([
        inboxItem({ id: 'new-settings', status: 'done', depth: 20, multipv: 4 }),
        inboxItem({ id: 'snapshot-settings', status: 'done', depth: 18, multipv: 2 }),
      ])
    })
    await waitFor(() => expect(latest().state).toBe('done'))

    expect(getSpy).toHaveBeenCalledWith('snapshot-settings', expect.anything())
    expect(latest().displayedConfig).toEqual({ depth: 18, multipv: 2 })
  })

  it('keeps completed review when settings change without hydrating or submitting', async () => {
    const listSpy = vi.spyOn(analyzer, 'listReviews').mockResolvedValue([
      inboxItem({ id: 'job-done', status: 'done', depth: 18, multipv: 3 }),
    ])
    const createSpy = vi.spyOn(analyzer, 'createReview')
    vi.spyOn(analyzer, 'getReview').mockResolvedValue(
      snapshot('done', { summary: SUMMARY_DATA }),
    )
    const { latest, changeSettings } = renderHarness(PGN, 'game-1')
    await waitFor(() => expect(latest().state).toBe('done'))

    await act(async () => { changeSettings(20, 4) })

    expect(latest().state).toBe('done')
    expect(latest().displayedConfig).toEqual({ depth: 18, multipv: 3 })
    expect(listSpy).toHaveBeenCalledOnce()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('keeps live polling running when settings change', async () => {
    vi.spyOn(analyzer, 'listReviews').mockResolvedValue([])
    let pollSignal!: AbortSignal
    vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-started', status: 'queued', engine: null,
    })
    vi.spyOn(analyzer, 'getReview').mockImplementation(
      async (_id, signal) => {
        pollSignal = signal
        return new Promise(() => {})
      },
    )
    const { latest, changeSettings } = renderHarness(PGN, 'game-1')
    await waitFor(() => expect(latest().state).toBe('idle'))
    await act(async () => { latest().start() })
    await waitFor(() => expect(pollSignal).toBeDefined())

    await act(async () => { changeSettings(20, 4) })

    expect(latest().state).toBe('running')
    expect(pollSignal.aborted).toBe(false)
    expect(analyzer.createReview).toHaveBeenCalledOnce()
    expect(latest().displayedConfig).toEqual({ depth: 18, multipv: 2 })
  })

  it('start() during an in-flight hydrate wins without switching jobs', async () => {
    let resolveList!: (jobs: ReviewInboxItem[]) => void
    vi.spyOn(analyzer, 'listReviews').mockImplementation(
      () => new Promise((r) => { resolveList = r }),
    )
    const createSpy = vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-started', status: 'queued', engine: null,
    })
    const getSpy = vi.spyOn(analyzer, 'getReview').mockResolvedValue(
      snapshot('done', {
        id: 'job-started',
        moves: [move(1, 'best')],
        summary: SUMMARY_DATA,
      }),
    )
    // Mount auto-fires hydrate; its lookup hangs (resolveList not called yet).
    const { latest } = renderHarness(PGN, 'game-1')
    expect(latest().state).toBe('hydrating')

    await act(async () => { latest().start() })
    // The hydrate lookup resolving late (after start() already won) must not
    // hijack the run — resolve it now and let everything settle.
    resolveList([inboxItem({ id: 'job-hydrated', status: 'done' })])
    await waitFor(() => expect(latest().state).toBe('done'))

    expect(createSpy).toHaveBeenCalledOnce()
    expect(getSpy).toHaveBeenCalledOnce()
    expect(getSpy).toHaveBeenCalledWith('job-started', expect.anything())
    expect(latest().moves.length).toBe(1)
  })
})
