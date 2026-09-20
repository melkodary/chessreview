import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '../config'
import { postJson } from './request'

describe('postJson', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts serialized JSON with the caller signal and parses the response', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'job-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal

    const result = await postJson<{ id: string }>(
      '/reviews',
      { pgn: '1. e4 *' },
      () => new Error('Review failed'),
      signal,
    )

    expect(result).toEqual({ id: 'job-1' })
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn: '1. e4 *' }),
      signal,
    })
  })

  it('throws the endpoint-specific error for a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    const error = new Error('Explain is disabled')

    await expect(
      postJson('/reviews/explain', {}, () => error),
    ).rejects.toBe(error)
  })
})
