import type { MoveReview } from '../api/review'
import { formatMoveEval } from '../eval'
import { heuristicGuide, type GuideText } from '../guide/guideText'
import MoveClassificationIcon from './MoveClassificationIcon'
import styles from './GuideBubble.module.css'

interface Props {
  move: MoveReview
  guide?: GuideText
}

export default function GuideBubble({ move, guide = heuristicGuide }: Props) {
  return (
    <div
      className={styles.bubble}
      data-classification={move.classification}
      style={{ borderLeft: `3px solid var(--review-${move.classification})` }}
    >
      <span className={styles.icon}>
        <MoveClassificationIcon classification={move.classification} />
      </span>
      <span className={styles.text}>{guide.describe(move)}</span>
      <span className={styles.eval}>{formatMoveEval(move.evalAfterPlayed, move.mateAfterPlayed)}</span>
    </div>
  )
}
