import type { Classification, ReviewSummary as Summary } from '../api/review'
import MoveClassificationIcon from './MoveClassificationIcon'
import { CLASS_LABEL, CLASS_ORDER } from './reviewClassifications'
import styles from './ReviewSummary.module.css'
import grid from './scoreboardGrid.module.css'

interface Props {
  summary: Summary
  whiteName: string
  blackName: string
  isUserWhite: boolean
  // Never key this on the engine label string — engineSource is what the
  // dedupe ordering and the routing rule actually trust.
  engineSource?: 'backend' | 'frontend' | null
}

function ScoreRow({ label, whiteCount, classification, blackCount }: {
  label: string
  whiteCount: number
  classification: Classification
  blackCount: number
}) {
  const tint = { color: `var(--review-${classification})` }
  return (
    <div className={grid.row} data-row>
      <span className={grid.rowLabel}>{label}</span>
      <span className={styles.count} style={tint}>{whiteCount}</span>
      <span className={grid.rowIcon}><MoveClassificationIcon classification={classification} /></span>
      <span className={styles.count} style={tint}>{blackCount}</span>
    </div>
  )
}

export default function ReviewSummary({ summary, whiteName, blackName, isUserWhite, engineSource }: Props) {
  const hasGameRating = summary.white.gameRating != null || summary.black.gameRating != null

  return (
    <div className={styles.root}>
      {engineSource === 'frontend' && (
        <span
          className={styles.provenance}
          data-testid="review-provenance"
          title="Graded by your browser's engine. A full backend review will replace it."
        >
          browser engine
        </span>
      )}
      <div className={grid.grid}>
        <div className={grid.headRow} data-row>
          <div className={`${styles.side} ${isUserWhite ? styles.userSide : ''}`}>
            <span className={styles.player}>
              <span className={`${styles.chip} ${styles.chipWhite}`} />
              <span className={styles.playerName}>{whiteName}</span>
            </span>
            <span className={styles.accuracy}>
              {summary.white.accuracy != null ? summary.white.accuracy.toFixed(1) : '—'}
              {summary.white.accuracy != null && <span className={styles.pct}>%</span>}
            </span>
          </div>
          <span className={grid.rowIcon} />
          <div className={`${styles.side} ${styles.sideBlack} ${!isUserWhite ? styles.userSide : ''}`}>
            <span className={`${styles.player} ${styles.playerBlack}`}>
              <span className={`${styles.chip} ${styles.chipBlack}`} />
              <span className={styles.playerName}>{blackName}</span>
            </span>
            <span className={styles.accuracy}>
              {summary.black.accuracy != null ? summary.black.accuracy.toFixed(1) : '—'}
              {summary.black.accuracy != null && <span className={styles.pct}>%</span>}
            </span>
          </div>
        </div>

        {CLASS_ORDER.map((c) => (
          <ScoreRow
            key={c}
            label={CLASS_LABEL[c]}
            classification={c}
            whiteCount={summary.white.counts[c] ?? 0}
            blackCount={summary.black.counts[c] ?? 0}
          />
        ))}

        {hasGameRating && (
          <div className={styles.gameRatingFooter} data-game-rating-row>
            <span className={styles.gameRatingValue}>
              {summary.white.gameRating?.toLocaleString() ?? '—'}
            </span>
            <span className={styles.gameRatingLabel}>Game rating</span>
            <span className={`${styles.gameRatingValue} ${styles.gameRatingValueBlack}`}>
              {summary.black.gameRating?.toLocaleString() ?? '—'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
