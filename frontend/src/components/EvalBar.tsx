import { formatEval, isWhiteAhead, whitePercent } from '../eval'
import styles from './EvalBar.module.css'

interface Props {
  evaluation: number
  mate: number | null
  // Board is oriented Black-at-bottom (the user plays Black). The bar's
  // color halves swap top/bottom to match; White stays White-colored.
  flipped?: boolean
  // Held from a position the board has left; dims so it doesn't read as live.
  stale?: boolean
}

export default function EvalBar({ evaluation, mate, flipped = false, stale = false }: Props) {
  const pct = whitePercent(evaluation, mate)
  const whiteAhead = isWhiteAhead({ evaluation, mate })
  const label = formatEval({ evaluation, mate })
  const whiteAtBottom = !flipped
  const aheadAtBottom = whiteAhead === whiteAtBottom
  return (
    <div
      className={`${styles.bar} ${stale ? styles.stale : ''}`}
      data-testid="eval-bar"
      data-stale={stale ? 'true' : undefined}
    >
      <div
        className={`${styles.top} ${whiteAtBottom ? styles.colorBlack : styles.colorWhite}`}
        style={{ height: `${whiteAtBottom ? 100 - pct : pct}%` }}
        data-color={whiteAtBottom ? 'black' : 'white'}
      />
      <div
        className={`${styles.bottom} ${whiteAtBottom ? styles.colorWhite : styles.colorBlack}`}
        style={{ height: `${whiteAtBottom ? pct : 100 - pct}%` }}
        data-color={whiteAtBottom ? 'white' : 'black'}
      />
      <span
        className={`${styles.label} ${aheadAtBottom ? styles.labelPosBottom : styles.labelPosTop} ${
          whiteAhead ? styles.labelColorWhite : styles.labelColorBlack
        }`}
      >
        {label}
      </span>
    </div>
  )
}
