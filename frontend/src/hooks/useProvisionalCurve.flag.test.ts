import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { SETTINGS_STORAGE, STORAGE_KEYS } from '../storage'

// Flag OFF is a kill switch, not a preference: the sweep must never reach the
// browser engine or the conversion endpoint, leaving the graph byte-identical
// to what it drew before this feature existed.
vi.mock('../engine/sweepGame', () => ({ sweepGame: vi.fn() }))
vi.mock('../api/review', () => ({ winChance: vi.fn() }))

import { useProvisionalCurve } from './useProvisionalCurve'
import { sweepGame } from '../engine/sweepGame'
import { winChance } from '../api/review'

const mockSweep = vi.mocked(sweepGame)
const mockWinChance = vi.mocked(winChance)

describe('useProvisionalCurve — provisional curve off', () => {
  beforeEach(() => {
    localStorage.clear()
    mockSweep.mockReset()
    mockWinChance.mockReset()
  })

  it('never touches the engine or the endpoint, and yields no points', () => {
    const { result } = renderHook(() => useProvisionalCurve({
      positions: [{ fen: 'start' }, { fen: 'p1' }, { fen: 'p2' }],
      enabled: false,
    }))

    expect(mockSweep).not.toHaveBeenCalled()
    expect(mockWinChance).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('persists the setting as a real off, so a reload keeps the switch thrown', () => {
    SETTINGS_STORAGE.provisionalCurve.save(false)
    expect(localStorage.getItem(STORAGE_KEYS.provisionalCurve)).toBe('false')
    expect(SETTINGS_STORAGE.provisionalCurve.load()).toBe(false)
  })
})
