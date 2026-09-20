import { Fragment, useRef, useState } from 'react'
import type { Game } from '../api/types'
import type { ReviewInboxItem } from '../api/analyzer'
import { STATUS_LABEL, statusDotKey, metric } from './reviewStatus'
import { parseGameMeta, reviewHighlights, type GameResult } from './gameList.meta'
import MoveClassificationIcon from '../components/MoveClassificationIcon'
import { CLASS_LABEL } from '../components/reviewClassifications'
import styles from './GameList.module.css'

const resultClass: Record<GameResult, string> = {
  W: styles.win,
  L: styles.loss,
  D: styles.draw,
}

interface Props {
  username?: string
  games: Game[]
  loading: boolean
  error: string
  before?: string
  beforeLabel?: string
  todayKey: string
  canLoadMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onBeforeChange: (value: string) => void
  onSelect: (game: Game) => void
  reviewFor?: (game: Game) => ReviewInboxItem | undefined
  onQueueReview?: (game: Game) => void
}

export default function GameList({
  username, games, loading, error, before, beforeLabel, todayKey,
  canLoadMore, onLoadMore, onRetry, onBeforeChange, onSelect,
  reviewFor, onQueueReview,
}: Props) {
  const picker = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const closePicker = () => {
    picker.current?.hidePopover?.()
    setPickerOpen(false)
  }

  const rows = games.map((game) => {
    const job = reviewFor?.(game)
    return {
      game,
      meta: parseGameMeta(game, username ?? ''),
      job,
      highlights: job?.status === 'done' && job.counts ? reviewHighlights(job.counts) : [],
    }
  })

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.heading}>Recent games</span>
          <div className={styles.dateControls}>
            <button
              className={styles.dateLauncher}
              popoverTarget="game-date-picker"
              aria-expanded={pickerOpen}
            >
              {beforeLabel ? `Through ${beforeLabel} ▾` : 'Latest ▾'}
            </button>
            {before && (
              <button className={styles.dateReset} onClick={() => onBeforeChange('')}>Latest</button>
            )}
            <div
              ref={picker}
              id="game-date-picker"
              popover="auto"
              className={styles.datePicker}
              onToggle={(event) => setPickerOpen(event.newState === 'open')}
            >
              <label htmlFor="game-before">Show games through date</label>
              <input
                id="game-before"
                type="date"
                value={before ?? ''}
                max={todayKey}
                className={styles.dateInput}
                onChange={(event) => {
                  closePicker()
                  onBeforeChange(event.currentTarget.value)
                }}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className={styles.fetchError}>
            <p className={styles.error}>{error}</p>
            <button className={styles.retry} onClick={onRetry}>Try again</button>
          </div>
        )}

        <div className={styles.list}>
          {loading && games.length === 0 && !error && (
            <p className={styles.empty}>Loading…</p>
          )}
          {!loading && games.length === 0 && !error && (
            <p className={styles.empty}>
              {beforeLabel ? `No games found through ${beforeLabel}.` : 'No games found.'}
            </p>
          )}
          {rows.map(({ game, meta, job, highlights }, i) => {
            const previousDate = rows[i - 1]?.meta.dateLabel
            return (
              <Fragment key={game.id}>
                {meta.dateLabel !== previousDate && (
                  <h2 className={styles.dateHeading}>{meta.dateLabel}</h2>
                )}
                <div
                  onClick={() => onSelect(game)}
                  data-testid="game-row"
                  className={[
                    styles.row,
                    i < games.length - 1 ? styles.rowBordered : '',
                    highlights.length ? styles.rowHighlighted : '',
                    job?.counts?.brilliant ? styles.rowBrilliant : '',
                  ].join(' ')}
                >
                  <span className={`${styles.result} ${resultClass[meta.result]}`}>{meta.result}</span>
                  <span className={styles.opponent}>vs {meta.opponent}</span>
                  {onQueueReview && (
                    <ReviewButton
                      job={job}
                      onQueue={(e) => { e.stopPropagation(); onQueueReview(game) }}
                    />
                  )}
                  {highlights.length > 0 && (
                    <span className={styles.highlights} data-testid="review-highlights">
                      {highlights.map(({ classification, count }) => (
                        <span
                          key={classification}
                          className={styles.highlight}
                          data-testid="review-highlight"
                          data-classification={classification}
                          style={{ color: `var(--review-${classification})` }}
                        >
                          <span className={styles.highlightCount}>
                            <MoveClassificationIcon classification={classification} />
                            {count}
                          </span>
                          <span className={styles.highlightLabel}>{CLASS_LABEL[classification]}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>

        {canLoadMore && (
          <button
            onClick={onLoadMore}
            disabled={loading}
            className={styles.loadMore}
            data-testid="load-more"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}

interface ReviewButtonProps {
  job: ReviewInboxItem | undefined
  onQueue: (e: React.MouseEvent) => void
}

function ReviewButton({ job, onQueue }: ReviewButtonProps) {
  if (!job) {
    return (
      <button
        className={styles.reviewBtn}
        onClick={onQueue}
        data-testid="review-btn"
      >
        Review
      </button>
    )
  }

  const m = metric(job)
  const dotKey = statusDotKey(job.status)

  if (job.status === 'queued' || job.status === 'running') {
    return (
      <span className={`${styles.reviewBtn} ${styles.reviewBtnActive}`} data-testid="review-btn">
        <span className={`${styles.reviewDot} ${styles[dotKey] ?? ''}`} aria-hidden="true" />
        {STATUS_LABEL[job.status]}{m.text ? ` ${m.text}` : ''}
      </span>
    )
  }

  if (job.status === 'done') {
    return (
      <>
        <span className={`${styles.reviewBtn} ${styles.reviewBtnDone}`} data-testid="review-btn">
          ✓ {m.text}
        </span>
        {job.engineSource === 'frontend' && (
          <svg
            className={styles.provenance}
            viewBox="0 0 14 14"
            role="img"
            aria-label="Browser engine"
            data-testid="review-provenance"
          >
            <title>Browser engine</title>
            <rect x="1" y="2" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" />
            <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" />
            <circle cx="3" cy="3.5" r="0.6" fill="currentColor" />
            <circle cx="5" cy="3.5" r="0.6" fill="currentColor" />
          </svg>
        )}
      </>
    )
  }

  // error or canceled — show retry
  return (
    <button
      className={`${styles.reviewBtn} ${styles.reviewBtnError}`}
      onClick={onQueue}
      data-testid="review-btn"
    >
      Failed — retry
    </button>
  )
}
