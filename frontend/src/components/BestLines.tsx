import type { CSSProperties } from 'react'
import type { AnalysisLine } from '../api/analyzer'
import { formatEval } from '../eval'
import styles from './BestLines.module.css'

interface Props {
  lines: AnalysisLine[]
  loading: boolean
  error: boolean
  // lines[0..freshCount) are analysis of the position on the board; the rest are
  // held from a previous one and render dimmed.
  freshCount: number
  // Rows of height to reserve, so the panel never shoves the move list around.
  rows: number
  // Board is oriented Black-at-bottom (the user plays Black): a line
  // favoring White should read as "losing" (red), not "winning" (green).
  flipped?: boolean
  onSelectLine?: (line: AnalysisLine) => void
}

function evalSign(line: AnalysisLine, flipped: boolean): 'positive' | 'negative' | 'neutral' {
  const raw = line.mate !== null ? line.mate : line.evaluation
  const v = flipped ? -raw : raw
  if (v > 0) return 'positive'
  if (v < 0) return 'negative'
  return 'neutral'
}

export default function BestLines({
  lines, loading, error, freshCount, rows, flipped = false, onSelectLine,
}: Props) {
  return (
    // The one permitted inline style: a runtime-driven value (frontend/CLAUDE.md).
    <div className={styles.panel} style={{ '--rows': rows } as CSSProperties}>
      {loading && lines.length === 0 && <div className={styles.status}>Analyzing...</div>}
      {error && !loading && <div className={styles.error}>Analysis unavailable.</div>}
      {!loading && !error && lines.length === 0 && (
        <div className={styles.status}>No analysis yet.</div>
      )}

      {!error && lines.map((line, i) => {
        const sign = evalSign(line, flipped)
        const stale = i >= freshCount
        const disabled = stale || !line.pvUci?.[0]
        return (
          <button
            type="button"
            key={i}
            className={`${styles.line} ${stale ? styles.stale : ''}`}
            data-testid="best-line"
            data-stale={stale ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onSelectLine?.(line)}
          >
            <span className={`${styles.badge} ${styles[sign]}`} data-sign={sign}>
              {formatEval(line)}
            </span>
            <span
              className={`${styles.moves} ${i === 0 ? styles.primary : ''}`}
              data-testid="best-line-moves"
            >
              {line.moves.join(' ')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
