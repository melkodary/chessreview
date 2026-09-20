import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFetch } from './useFetch'

describe('useFetch', () => {
  it('starts in loading state', () => {
    const fn = vi.fn().mockResolvedValue('x')
    const { result } = renderHook(() => useFetch(fn, []))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('')
  })

  it('returns data on success', async () => {
    const fn = vi.fn().mockResolvedValue({ value: 42 })
    const { result } = renderHook(() => useFetch(fn, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ value: 42 })
    expect(result.current.error).toBe('')
  })

  it('returns error message on rejection', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFetch(fn, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.data).toBeNull()
  })

  it('returns generic error message on non-Error rejection', async () => {
    const fn = vi.fn().mockRejectedValue('string thrown')
    const { result } = renderHook(() => useFetch(fn, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Unknown error')
  })

  it('re-runs when deps change', async () => {
    const fn = vi.fn().mockResolvedValue('a')
    let dep = 1
    const { result, rerender } = renderHook(() => useFetch(fn, [dep]))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fn).toHaveBeenCalledTimes(1)
    dep = 2
    rerender()
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
  })

  it('keeps the previous data reference when isEqual reports no change', async () => {
    const fn = vi.fn(async () => [{ id: 1 }])
    let dep = 1
    const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const { result, rerender } = renderHook(() => useFetch(fn, [dep], { isEqual }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const firstRef = result.current.data
    dep = 2
    rerender()
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    // New fetch returned structurally-equal data → reference must be unchanged.
    expect(result.current.data).toBe(firstRef)
  })

  it('replaces data when isEqual reports a change', async () => {
    let payload = [{ id: 1 }]
    const fn = vi.fn(async () => payload)
    let dep = 1
    const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const { result, rerender } = renderHook(() => useFetch(fn, [dep], { isEqual }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    payload = [{ id: 2 }]
    dep = 2
    rerender()
    await waitFor(() => expect(result.current.data).toEqual([{ id: 2 }]))
  })
})
