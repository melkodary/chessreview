import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importPgn } from '../api/sources/pgn'
import { routes } from '../router'
import styles from './UsernameInput.module.css'

// Paste or upload a PGN, pick the side to review, land on its review page. The
// side's player name becomes the URL's userId — GameShell picks the reviewed
// side by matching it against white/black.
export default function PgnImport() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [side, setSide] = useState<'white' | 'black'>('white')
  const [error, setError] = useState<string | null>(null)

  const onFile = (file: File | undefined) => {
    if (file) file.text().then(setText)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const [game] = await importPgn(text)
      navigate(routes.review('pgn', game[side].username, game.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not a valid PGN')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        aria-label="PGN"
        placeholder='[Event "…"]&#10;&#10;1. e4 e5 …'
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null) }}
        className={styles.input}
        rows={6}
        autoFocus
      />
      <input
        type="file"
        accept=".pgn,text/plain"
        aria-label="PGN file"
        onChange={(e) => onFile(e.target.files?.[0])}
        className={styles.input}
      />
      <div className={styles.actions}>
        <div className={styles.sideToggle} role="group" aria-label="Review as">
          {(['white', 'black'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`${styles.sourceBtn} ${side === s ? styles.sourceBtnActive : ''}`}
            >
              {s === 'white' ? 'As White' : 'As Black'}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!text.trim()} className={styles.submit}>
          Import
        </button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  )
}
