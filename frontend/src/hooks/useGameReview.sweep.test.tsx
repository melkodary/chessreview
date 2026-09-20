import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

import * as analyzer from '../api/analyzer'
import type { AnalysisLine, ReviewSnapshot } from '../api/analyzer'
import { putEval, clearEvalCache } from '../engine/evalCache'
import { useGameReview } from './useGameReview'
import { SettingsProvider } from '../settings'
import { useSettings } from '../settingsContext'
import { STORAGE_KEYS, WASM_ENGINE_NAME } from '../storage'

// GRADE_WITH_FRONTEND_ENGINE is on by default: start() runs pass 2 (the browser
// sweep) before any job exists, then submits the cached evals once.
const PGN = '1. e4 e5 *'
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const POSITIONS = [{ fen: START }, { fen: AFTER_E4 }, { fen: AFTER_E5 }]

type HookResult = ReturnType<typeof useGameReview>

function Harness({ onState, onSettings }: {
  onState: (s: HookResult) => void
  onSettings: (setDepth: (d: number) => void, setMultiPv: (m: number) => void) => void
}) {
  const state = useGameReview(PGN, { gameId: 'g1' }, POSITIONS)
  const { setReviewDepth, setReviewMultiPv } = useSettings()
  useEffect(() => { onState(state) })
  useEffect(() => { onSettings(setReviewDepth, setReviewMultiPv) }, [onSettings, setReviewDepth, setReviewMultiPv])
  return null
}

function renderHarness() {
  const states: HookResult[] = []
  let setDepth!: (d: number) => void
  let setMultiPv!: (m: number) => void
  render(
    <SettingsProvider>
      <Harness
        onState={(s) => { states.push(s) }}
        onSettings={(d, m) => { setDepth = d; setMultiPv = m }}
      />
    </SettingsProvider>,
  )
  return {
    latest: () => states[states.length - 1],
    changeSettings: (d: number, m: number) => { setDepth(d); setMultiPv(m) },
  }
}

function line(evaluation: number, pvUci: string[]): AnalysisLine {
  return { moves: [], evaluation, mate: null, pvUci }
}

function cacheGame(depth: number, multipv: number) {
  putEval(START, [line(0.3, ['e2e4']), line(0.2, ['d2d4'])], depth, multipv)
  putEval(AFTER_E4, [line(0.1, ['e7e5']), line(0.0, ['c7c5'])], depth, multipv)
  putEval(AFTER_E5, [line(0.25, ['g1f3']), line(0.2, ['b1c3'])], depth, multipv)
}

function doneSnapshot(): ReviewSnapshot {
  return {
    id: 'job-1', source: 'chesscom', status: 'done', white: 'a', black: 'b',
    reviewed: 2, totalPlies: 2, userId: null, gameId: 'g1', accuracy: 90,
    createdAt: '', finishedAt: '', depth: 20, multipv: 3, engine: WASM_ENGINE_NAME,
    moves: [],
    summary: {
      white: { accuracy: 90, counts: {}, biggestBlunderPly: null },
      black: { accuracy: 90, counts: {}, biggestBlunderPly: null },
      keyMoments: [], opening: null,
    },
    error: null,
  }
}

describe('useGameReview.start() — frontend-sourced review', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    clearEvalCache()
    vi.spyOn(analyzer, 'listReviews').mockResolvedValue([])
    vi.spyOn(analyzer, 'cancelReview').mockResolvedValue(undefined)
    vi.spyOn(analyzer, 'getReview').mockResolvedValue(doneSnapshot())
  })

  it('opens pass 2 at the request depth/MultiPV and creates no job row', async () => {
    const create = vi.spyOn(analyzer, 'createReview')
    const { latest, changeSettings } = renderHarness()
    await waitFor(() => expect(latest().state).toBe('idle'))
    await act(async () => { changeSettings(20, 3) })

    await act(async () => { latest().start() })

    expect(latest().state).toBe('running')
    expect(latest().sweep).toEqual({ depth: 20, multipv: 3 })
    expect(latest().displayedConfig).toEqual({ depth: 20, multipv: 3 })
    expect(create).not.toHaveBeenCalled()
  })

  it('submits the cached evals once, with the browser engine named, and polls the result', async () => {
    const create = vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-1', status: 'done', engine: WASM_ENGINE_NAME,
    })
    const { latest, changeSettings } = renderHarness()
    await waitFor(() => expect(latest().state).toBe('idle'))
    await act(async () => { changeSettings(20, 3) })
    await act(async () => { latest().start() })

    cacheGame(20, 3)
    await act(async () => { latest().reportSweep(2) })
    expect(latest().swept).toBe(2)
    await act(async () => { latest().submitSweep(true) })
    await act(async () => { latest().submitSweep(true) }) // a late second call is a no-op

    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(PGN, 20, 3, expect.objectContaining({ gameId: 'g1' }), {
      engine: WASM_ENGINE_NAME,
      plies: [
        {
          fenBefore: START, fenAfter: AFTER_E4,
          beforeLines: [{ uci: 'e2e4', cp: 30 }, { uci: 'd2d4', cp: 20 }],
          afterEval: { cp: 10 },
        },
        {
          fenBefore: AFTER_E4, fenAfter: AFTER_E5,
          beforeLines: [{ uci: 'e7e5', cp: 10 }, { uci: 'c7c5', cp: 0 }],
          afterEval: { cp: 25 },
        },
      ],
    })
    expect(latest().sweep).toBeNull()
    expect(latest().swept).toBe(0)
    await waitFor(() => expect(latest().state).toBe('done'))
    expect(latest().engine).toBe(WASM_ENGINE_NAME)
  })

  it('falls back to a backend search when the sweep gave up or the cache is short', async () => {
    const create = vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-1', status: 'queued', engine: null,
    })
    const { latest } = renderHarness()
    await waitFor(() => expect(latest().state).toBe('idle'))

    await act(async () => { latest().start() })
    cacheGame(12, 1) // pass-1 depth only: nothing at the request depth
    await act(async () => { latest().submitSweep(true) })
    expect(create).toHaveBeenLastCalledWith(PGN, 18, 2, expect.anything(), undefined)
    await waitFor(() => expect(latest().state).toBe('done'))

    await act(async () => { latest().start() })
    await act(async () => { latest().submitSweep(false) })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenLastCalledWith(PGN, 18, 2, expect.anything(), undefined)
  })

  it('start() is a no-op during pass 2, and cancel ends it without a job', async () => {
    const create = vi.spyOn(analyzer, 'createReview')
    const { latest } = renderHarness()
    await waitFor(() => expect(latest().state).toBe('idle'))

    await act(async () => { latest().start() })
    await act(async () => { latest().start() })
    expect(latest().sweep).not.toBeNull()

    await act(async () => { latest().cancel() })
    expect(latest().state).toBe('idle')
    expect(latest().sweep).toBeNull()
    await act(async () => { latest().submitSweep(true) }) // the aborted sweep never submits
    expect(create).not.toHaveBeenCalled()
    expect(analyzer.cancelReview).not.toHaveBeenCalled()
  })

  it('routes to the backend when the browser-engine setting is off', async () => {
    localStorage.setItem(STORAGE_KEYS.provisionalCurve, 'false')
    const create = vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-1', status: 'queued', engine: null,
    })
    const { latest } = renderHarness()
    await waitFor(() => expect(latest().state).toBe('idle'))

    await act(async () => { latest().start() })

    expect(latest().sweep).toBeNull()
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0][4]).toBeUndefined()
  })
})
