import { useState } from 'react'
import { DEFAULT_SOURCE, SOURCES } from '../api/sources'
import type { Source } from '../api/types'
import PgnImport from './PgnImport'
import styles from './UsernameInput.module.css'

interface Props {
  onSubmit: (username: string, source: Source) => void
  onReviewLatest: (username: string, source: Source) => void
  latestLoading: boolean
}

export default function UsernameInput({ onSubmit, onReviewLatest, latestLoading }: Props) {
  const [username, setUsername] = useState('')
  const [source, setSource] = useState<Source>(DEFAULT_SOURCE)

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
          {source === 'pgn'
            ? 'Paste or upload a PGN to review the game.'
            : `Enter your ${SOURCES[source].label} username to review your games.`}
        </p>

        <div className={styles.sourceToggle} role="group" aria-label="Game source">
          {Object.entries(SOURCES).map(([value, s]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              aria-pressed={source === value}
              className={`${styles.sourceBtn} ${source === value ? styles.sourceBtnActive : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {source === 'pgn' ? <PgnImport /> : (
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
        )}
      </div>
  )
}
