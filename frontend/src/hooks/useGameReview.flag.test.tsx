import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

// Flag OFF routes everything to the backend: start() submits immediately, with
// no sweep and no payload — exactly the pre-feature behaviour.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  GRADE_WITH_FRONTEND_ENGINE: false,
}))

import * as analyzer from '../api/analyzer'
import { useGameReview } from './useGameReview'
import { SettingsProvider } from '../settings'

type HookResult = ReturnType<typeof useGameReview>
const POSITIONS = [{ fen: 'start' }, { fen: 'p1' }, { fen: 'p2' }]

function Harness({ onState }: { onState: (s: HookResult) => void }) {
  const state = useGameReview('1. e4 e5 *', {}, POSITIONS)
  useEffect(() => { onState(state) })
  return null
}

describe('useGameReview.start() — GRADE_WITH_FRONTEND_ENGINE off', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('queues a backend review at once, never opening a sweep', async () => {
    const create = vi.spyOn(analyzer, 'createReview').mockResolvedValue({
      id: 'job-1', status: 'queued', engine: null,
    })
    vi.spyOn(analyzer, 'getReview').mockImplementation(() => new Promise(() => {}))
    const states: HookResult[] = []
    render(<SettingsProvider><Harness onState={(s) => { states.push(s) }} /></SettingsProvider>)
    const latest = () => states[states.length - 1]

    await act(async () => { latest().start() })

    expect(latest().sweep).toBeNull()
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith('1. e4 e5 *', 18, 2, expect.anything(), undefined)
    expect(latest().state).toBe('running')
  })
})
