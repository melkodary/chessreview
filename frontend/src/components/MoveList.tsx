import { Fragment } from 'react'
import type { Classification } from '../api/review'
import type { ExploreNode } from '../hooks/useBoardExploration'
import MoveClassificationIcon from './MoveClassificationIcon'
import { SPECIAL_CLASSIFICATIONS } from './reviewClassifications'
import styles from './MoveList.module.css'
import { buildPairs, type Pair } from './moveList.pairs'

interface Position {
  fen: string
  san: string | null
  secondsSpent?: number | null
}

// Time spent on a move: < 10s → one decimal (8.4s); 10–59s → whole (14s);
// ≥ 60s → m:ss (1:23).
function formatSpent(s: number): string {
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 59.5) return `${Math.round(s)}s`
  const total = Math.round(s)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Bar fill fraction for the think-time gauge: the move's raw share of the game's
// own slowest move (`max`). No floor, no curve — the slowest move fills the bar
// and every other move is its plain percentage of that, so a near-instant move
// reads as a near-empty sliver. Max-relative (not a fixed cap) so bars stay
// proportional whatever the time control.
function barFraction(s: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(1, Math.max(0, s / max))
}

interface Props {
  positions: Position[]
  currentIndex: number
  onSelect: (index: number) => void
  reviews?: Map<number, Classification>
  // Exploration branch. When `branch` is non-empty the list renders the
  // variation after the deviation ply and dims the game continuation.
  branch?: ExploreNode[]
  branchIndex?: number
  deviationPly?: number
  onSelectBranch?: (lineIndex: number) => void
  // Per-branch-ply grading, aligned to `branch` by index (Review only): a
  // classification badge when done, a spinner while the backend grades it.
  branchGrades?: { status: 'pending' | 'done' | 'error'; classification?: Classification }[]
}

export default function MoveList({
  positions, currentIndex, onSelect, reviews,
  branch, branchIndex = 0, deviationPly = 0, onSelectBranch, branchGrades,
}: Props) {
  const pairs = buildPairs(positions.length - 1)
  const exploring = !!branch && branch.length > 0

  const cellClass = (posIdx: number) =>
    `${styles.cell} ${currentIndex === posIdx ? styles.active : ''}` +
    (exploring && posIdx > deviationPly ? ` ${styles.dimmed}` : '')

  const hasTimes = positions.some((p) => p.secondsSpent != null)
  // Slowest move in the game — the bar's full-scale reference.
  const maxSpent = Math.max(0, ...positions.map((p) => p.secondsSpent ?? 0))

  const cellContent = (posIdx: number) => {
    const c = reviews?.get(posIdx)
    return (
      <>
        {c && SPECIAL_CLASSIFICATIONS.has(c) && (
          <span className={styles.moveIcon}>
            <MoveClassificationIcon classification={c} />
          </span>
        )}
        <span>{positions[posIdx]?.san}</span>
      </>
    )
  }

  // One stacked time readout (white above black) in the dedicated time column: a
  // horizontal magnitude bar (width ∝ think time) + the small time. Empty slot
  // when a ply has no derivable time, so white/black stay aligned.
  const timeEntry = (posIdx: number) => {
    const spent = positions[posIdx]?.secondsSpent
    if (spent == null) return <span />
    const isWhite = posIdx % 2 === 1 // ply 1,3,5… are white's moves
    return (
      <span className={styles.timeEntry} data-testid="move-time">
        <span className={styles.timeBar} aria-hidden="true">
          <span
            className={`${styles.timeBarFill} ${isWhite ? styles.fillWhite : styles.fillBlack}`}
            data-testid="time-bar"
            data-side={isWhite ? 'white' : 'black'}
            style={{ width: `${barFraction(spent, maxSpent) * 100}%` }}
          />
        </span>
        <span className={styles.time}>{formatSpent(spent)}</span>
      </span>
    )
  }

  const gameCell = (posIdx: number) => (
    <span
      data-testid="move-item"
      data-dimmed={String(exploring && posIdx > deviationPly)}
      className={cellClass(posIdx)}
      onClick={() => onSelect(posIdx)}
    >
      {cellContent(posIdx)}
    </span>
  )

  // The explored variation, rendered as a token stream with move numbers. Branch
  // node i (0-based) is reached from half-move `deviationPly + i`, so the move it
  // represents is half-move `deviationPly + i + 1`.
  const branchBlock = exploring ? (
    <div className={styles.branch} data-testid="branch">
      {branch!.map((node, i) => {
        const fromPly = deviationPly + i // position the move is played from
        const isWhite = fromPly % 2 === 0
        const moveNum = Math.floor(fromPly / 2) + 1
        const lineIndex = i + 1
        const grade = branchGrades?.[i]
        const gradeClass = grade?.status === 'done' ? grade.classification : undefined
        return (
          <span key={i} className={styles.branchMove}>
            {(isWhite || i === 0) && (
              <span className={styles.moveNum}>{isWhite ? `${moveNum}.` : `${moveNum}…`}</span>
            )}
            <span
              data-testid="branch-move"
              data-branch-index={lineIndex}
              data-active={String(branchIndex === lineIndex)}
              data-grade={grade?.status ?? 'none'}
              className={`${styles.cell} ${branchIndex === lineIndex ? styles.active : ''}`}
              onClick={() => onSelectBranch?.(lineIndex)}
            >
              {gradeClass && SPECIAL_CLASSIFICATIONS.has(gradeClass) && (
                <span className={styles.moveIcon}>
                  <MoveClassificationIcon classification={gradeClass} />
                </span>
              )}
              {grade?.status === 'pending' && (
                <span className={styles.branchPending} data-testid="branch-pending" aria-label="grading">⋯</span>
              )}
              {node.san}
            </span>
          </span>
        )
      })}
    </div>
  ) : null

  // The branch is injected right after the row holding the deviation ply (or at
  // the top when the fork is the start position).
  const pairHoldsDeviation = (p: Pair) =>
    p.whiteIdx === deviationPly || p.blackIdx === deviationPly

  return (
    <div className={styles.panel} data-testid="move-list">
      {exploring && deviationPly === 0 && branchBlock}
      {pairs.map((pair) => (
        <Fragment key={pair.moveNum}>
          <div className={`${styles.row} ${hasTimes ? styles.rowTimed : ''}`}>
            <span className={styles.moveNum}>{pair.moveNum}.</span>
            {gameCell(pair.whiteIdx)}
            {pair.blackIdx !== null ? gameCell(pair.blackIdx) : <span />}
            {hasTimes && (
              <>
                <span className={styles.timeSpacer} aria-hidden="true" />
                <div className={styles.timeCol}>
                  {timeEntry(pair.whiteIdx)}
                  {pair.blackIdx !== null ? timeEntry(pair.blackIdx) : <span />}
                </div>
              </>
            )}
          </div>
          {exploring && pairHoldsDeviation(pair) && branchBlock}
        </Fragment>
      ))}
    </div>
  )
}
