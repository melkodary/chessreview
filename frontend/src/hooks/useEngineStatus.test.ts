import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

describe('useEngineStatus', () => {
  it('returns the engine status and re-renders on change', async () => {
    let listener: (() => void) | undefined
    let status = { url: '/engine/lite.js', state: 'idle' as const }
    vi.doMock('../engine/stockfish', () => ({
      engine: {
        onStatusChange: (cb: () => void) => { listener = cb; return () => { listener = undefined } },
        getStatus: () => status,
      },
    }))

    const { useEngineStatus } = await import('./useEngineStatus')
    const { result } = renderHook(() => useEngineStatus())

    expect(result.current).toEqual({ url: '/engine/lite.js', state: 'idle' })

    status = { url: '/engine/lite.js', state: 'ready' as const }
    act(() => listener?.())

    expect(result.current).toEqual({ url: '/engine/lite.js', state: 'ready' })

    vi.doUnmock('../engine/stockfish')
  })
})
