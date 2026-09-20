import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle', () => {
  it('sets base title when no arg', () => {
    renderHook(() => useDocumentTitle())
    expect(document.title).toBe('Chess Review')
  })

  it('sets prefixed title with arg', () => {
    renderHook(() => useDocumentTitle('rookiefan'))
    expect(document.title).toBe('rookiefan · Chess Review')
  })

  it('updates when arg changes', () => {
    let title: string | undefined = 'rookiefan'
    const { rerender } = renderHook(() => useDocumentTitle(title))
    expect(document.title).toBe('rookiefan · Chess Review')
    title = 'magnus'
    rerender()
    expect(document.title).toBe('magnus · Chess Review')
  })

  it('reverts to base when arg removed', () => {
    let title: string | undefined = 'rookiefan'
    const { rerender } = renderHook(() => useDocumentTitle(title))
    title = undefined
    rerender()
    expect(document.title).toBe('Chess Review')
  })
})
