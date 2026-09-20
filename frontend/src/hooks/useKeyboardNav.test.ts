import { describe, it, expect, vi } from 'vitest'
import { useLayoutEffect } from 'react'
import { renderHook } from '@testing-library/react'
import { useKeyboardNav } from './useKeyboardNav'

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }))
}

describe('useKeyboardNav', () => {
  it('fires left handler on ArrowLeft', () => {
    const left = vi.fn()
    renderHook(() => useKeyboardNav({ left }))
    press('ArrowLeft')
    expect(left).toHaveBeenCalledTimes(1)
  })

  it('fires right handler on ArrowRight', () => {
    const right = vi.fn()
    renderHook(() => useKeyboardNav({ right }))
    press('ArrowRight')
    expect(right).toHaveBeenCalledTimes(1)
  })

  it('ignores keys without handlers', () => {
    const left = vi.fn()
    renderHook(() => useKeyboardNav({ left }))
    press('ArrowDown')
    press('Enter')
    expect(left).not.toHaveBeenCalled()
  })

  it('uses latest handler reference across renders', () => {
    let count = 0
    const factory = () => () => { count++ }
    const { rerender } = renderHook(({ right }) => useKeyboardNav({ right }), {
      initialProps: { right: factory() },
    })
    rerender({ right: factory() })
    press('ArrowRight')
    expect(count).toBe(1)
  })

  // The real shape of the bug: React Router commits a location in a transition,
  // so the DOM (and any test polling it) sees the new tab before passive effects
  // flush. A keypress in that window must not reach the previous handler.
  it('has the latest handler by the layout phase of the same commit', () => {
    const seen: string[] = []
    const { rerender } = renderHook(({ tag }: { tag: string }) => {
      useKeyboardNav({ right: () => seen.push(tag) })
      useLayoutEffect(() => { press('ArrowRight') })
    }, { initialProps: { tag: 'first' } })
    seen.length = 0
    rerender({ tag: 'second' })
    expect(seen).toEqual(['second'])
  })

  it('removes listener on unmount', () => {
    const left = vi.fn()
    const { unmount } = renderHook(() => useKeyboardNav({ left }))
    unmount()
    press('ArrowLeft')
    expect(left).not.toHaveBeenCalled()
  })
})
