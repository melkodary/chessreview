import type { ReviewInboxItem } from '../api/analyzer'

export const STATUS_LABEL: Record<ReviewInboxItem['status'], string> = {
  queued:   'Queued',
  running:  'Running',
  done:     'Done',
  error:    'Failed',
  canceled: 'Canceled',
}

// Returns the CSS module key for the status dot; caller resolves: styles[statusDotKey(s)].
export function statusDotKey(status: ReviewInboxItem['status']): string {
  const keys: Record<ReviewInboxItem['status'], string> = {
    queued:   'dotQueued',
    running:  'dotRunning',
    done:     'dotDone',
    error:    'dotError',
    canceled: 'dotCanceled',
  }
  return keys[status]
}

export function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function metric(item: ReviewInboxItem): { text: string; muted: boolean } {
  switch (item.status) {
    case 'running':
      return { text: `${item.reviewed}/${item.totalPlies}`, muted: true }
    case 'done':
      return item.accuracy != null
        ? { text: `${item.accuracy.toFixed(0)}%`, muted: false }
        : { text: 'Done', muted: false }
    case 'error':
      return { text: 'Failed', muted: true }
    case 'canceled':
      return { text: '—', muted: true }
    default:
      return { text: '', muted: true }
  }
}
