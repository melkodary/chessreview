import { describe, it, expect, vi, afterEach } from 'vitest'
import { STATUS_LABEL, statusDotKey, timeAgo, metric } from './reviewStatus'
import type { ReviewInboxItem } from '../api/analyzer'

function item(overrides: Partial<ReviewInboxItem> = {}): ReviewInboxItem {
  return {
    id: 'j', source: 'lichess', status: 'done',
    white: 'a', black: 'b', reviewed: 4, totalPlies: 4,
    userId: 'a', gameId: '1', accuracy: 90, createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('STATUS_LABEL', () => {
  it('covers all statuses', () => {
    const statuses: ReviewInboxItem['status'][] = ['queued', 'running', 'done', 'error', 'canceled']
    for (const s of statuses) expect(STATUS_LABEL[s]).toBeTruthy()
  })
})

describe('statusDotKey', () => {
  it('returns a non-empty string for each status', () => {
    const statuses: ReviewInboxItem['status'][] = ['queued', 'running', 'done', 'error', 'canceled']
    for (const s of statuses) expect(statusDotKey(s)).toBeTruthy()
  })

  it('returns distinct keys', () => {
    const keys = (['queued', 'running', 'done', 'error', 'canceled'] as ReviewInboxItem['status'][])
      .map(statusDotKey)
    expect(new Set(keys).size).toBe(5)
  })
})

describe('timeAgo', () => {
  afterEach(() => { vi.useRealTimers() })

  it('returns "just now" for < 60s', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('just now')
  })

  it('returns minutes for < 60m', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago')
  })

  it('returns hours for < 24h', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago')
  })

  it('returns days for >= 24h', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago')
  })
})

describe('metric', () => {
  it('running → progress fraction, muted', () => {
    const m = metric(item({ status: 'running', reviewed: 3, totalPlies: 10 }))
    expect(m.text).toBe('3/10')
    expect(m.muted).toBe(true)
  })

  it('done with accuracy → percentage, not muted', () => {
    const m = metric(item({ status: 'done', accuracy: 88.6 }))
    expect(m.text).toBe('89%')
    expect(m.muted).toBe(false)
  })

  it('done without accuracy → "Done", not muted', () => {
    const m = metric(item({ status: 'done', accuracy: null }))
    expect(m.text).toBe('Done')
    expect(m.muted).toBe(false)
  })

  it('error → "Failed", muted', () => {
    const m = metric(item({ status: 'error' }))
    expect(m.text).toBe('Failed')
    expect(m.muted).toBe(true)
  })

  it('canceled → dash, muted', () => {
    const m = metric(item({ status: 'canceled' }))
    expect(m.text).toBe('—')
    expect(m.muted).toBe(true)
  })

  it('queued → empty, muted', () => {
    const m = metric(item({ status: 'queued' }))
    expect(m.text).toBe('')
    expect(m.muted).toBe(true)
  })
})
