import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StoredSetting } from './storage'
import { useStoredSetting } from './useStoredSetting'

describe('useStoredSetting', () => {
  it('loads once and persists each state update', () => {
    let stored = 3
    const setting: StoredSetting<number> = {
      load: () => stored,
      save: (value) => { stored = value },
    }

    const { result } = renderHook(() => useStoredSetting(setting))
    expect(result.current[0]).toBe(3)

    act(() => result.current[1](7))
    expect(result.current[0]).toBe(7)
    expect(stored).toBe(7)
  })
})
