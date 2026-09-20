import { useEffect, useRef, useState } from 'react'
import NavButton from '../components/NavButton'
import { ENABLE_EXPLAIN, EXPORT_FEEDBACK_MS } from '../config'
import styles from './viewer.module.css'

type Format = 'FEN' | 'PGN'

function FenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-testid="fen-icon">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </svg>
  )
}

function PgnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-testid="pgn-icon">
      <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
    </svg>
  )
}

function CopiedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-testid="copied-icon">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

function ExplainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" data-testid="explain-icon">
      <path d="M5 4h14v12H9l-4 4zM9 8h6M9 12h4" />
    </svg>
  )
}

interface Props {
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
  // At the game-line ends — disables ⏮/⏭ and, by default, ◀/▶.
  atStart: boolean
  atEnd: boolean
  // Overrides for ◀/▶ only (Analysis keeps them live while exploring a branch,
  // even at a game-line end). Default to atStart/atEnd.
  prevDisabled?: boolean
  nextDisabled?: boolean
  fen: string
  pgn: string
  onExplain?: () => void
}

// Shared move-navigation + export footer for the Review and Analysis panels.
export default function NavRow({
  onFirst, onPrev, onNext, onLast, atStart, atEnd, prevDisabled, nextDisabled,
  fen, pgn, onExplain,
}: Props) {
  const [feedback, setFeedback] = useState<{
    message: string
    error: boolean
    format: Format | null
  } | null>(null)
  const feedbackTimer = useRef<number | null>(null)
  const copyRequest = useRef(0)
  useEffect(() => () => {
    copyRequest.current += 1
    if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current)
  }, [])

  const showFeedback = (message: string, error: boolean, format: Format | null) => {
    if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current)
    setFeedback({ message, error, format })
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), EXPORT_FEEDBACK_MS)
  }

  const copy = async (format: Format, value: string) => {
    const request = ++copyRequest.current
    try {
      await navigator.clipboard.writeText(value)
      if (request !== copyRequest.current) return
      showFeedback(`${format} copied`, false, format)
    } catch {
      if (request !== copyRequest.current) return
      showFeedback('Couldn’t access clipboard', true, null)
    }
  }

  return (
    <div className={styles.viewerFooter} data-testid="viewer-footer">
      <div className={styles.navRow} data-testid="nav-row">
        <NavButton label="⏮︎" onClick={onFirst} disabled={atStart} />
        <NavButton label="◀" onClick={onPrev} disabled={prevDisabled ?? atStart} />
        <NavButton label="▶" onClick={onNext} disabled={nextDisabled ?? atEnd} />
        <NavButton label="⏭︎" onClick={onLast} disabled={atEnd} />
      </div>
      <div className={styles.exportToolbar} role="toolbar" aria-label="Move tools">
        <button
          type="button"
          className={styles.exportButton}
          aria-label="Copy FEN"
          title="Copy FEN"
          onClick={() => void copy('FEN', fen)}
        >
          {feedback?.format === 'FEN' ? <CopiedIcon /> : <FenIcon />}
        </button>
        <button
          type="button"
          className={styles.exportButton}
          aria-label="Copy PGN"
          title="Copy PGN"
          onClick={() => void copy('PGN', pgn)}
        >
          {feedback?.format === 'PGN' ? <CopiedIcon /> : <PgnIcon />}
        </button>
        {ENABLE_EXPLAIN && onExplain && (
          <button
            type="button"
            className={styles.exportButton}
            aria-label="Explain move"
            title="Explain move"
            onClick={onExplain}
          >
            <ExplainIcon />
          </button>
        )}
        {feedback && (
          <span
            className={`${styles.exportFeedback} ${feedback.error ? styles.exportError : ''}`}
            role={feedback.error ? 'alert' : 'status'}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  )
}
