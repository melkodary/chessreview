import { useState } from 'react'
import type { Source } from '../api/types'
import styles from './UsernameInput.module.css'

interface Props {
  onSubmit: (username: string, source: Source) => void
  onReviewLatest: (username: string, source: Source) => void
  latestLoading: boolean
}

const SOURCES: { value: Source; label: string }[] = [
  { value: 'chesscom', label: 'Chess.com' },
  { value: 'lichess', label: 'Lichess' },
]

export default function UsernameInput({ onSubmit, onReviewLatest, latestLoading }: Props) {
  const [username, setUsername] = useState('')
  const [source, setSource] = useState<Source>('chesscom')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = username.trim()
    if (trimmed) onSubmit(trimmed, source)
  }

  const isDisabled = !username.trim()

  return (
    <div className={styles.card}>
        <h1 className={styles.title}>♟ Chess Review</h1>
        <p className={styles.subtitle}>
          Enter your {source === 'lichess' ? 'Lichess' : 'Chess.com'} username to review your games.
        </p>

        <div className={styles.sourceToggle} role="group" aria-label="Game source">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSource(s.value)}
              aria-pressed={source === s.value}
              className={`${styles.sourceBtn} ${source === s.value ? styles.sourceBtnActive : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={styles.input}
            autoComplete="off"
            autoFocus
          />
          <div className={styles.actions}>
            <button
              type="button"
              disabled={isDisabled || latestLoading}
              onClick={() => onReviewLatest(username.trim(), source)}
              className={styles.submitSecondary}
            >
              {latestLoading ? 'Loading…' : 'Review Latest Game'}
            </button>
            <button type="submit" disabled={isDisabled || latestLoading} className={styles.submit}>
              Load Games
            </button>
          </div>
        </form>
      </div>
  )
}
