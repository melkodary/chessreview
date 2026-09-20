import type { JSX } from 'react'
import type { Classification } from '../api/review'
import styles from './MoveClassificationIcon.module.css'

interface Props {
  classification: Classification
}

// Every classification is a hand-drawn vector shape, white on the coloured
// circle, authored in the 0–14 viewBox and centred on (7, 7). Drawing them as
// paths (rather than font glyphs or OS emoji) keeps them crisp, centred, and
// identical across platforms.

// A single exclamation mark centred at `cx`. `k` scales the whole glyph (1 for
// a solo mark, <1 for one half of a pair). Filled, so it scales cleanly.
function Excl(cx: number, k: number): JSX.Element {
  const x = (rx: number) => (cx + rx * k).toFixed(2)
  const y = (ry: number) => (7 + ry * k).toFixed(2)
  return (
    <>
      <path
        d={`M${x(-0.85)} ${y(-3.7)} L${x(0.85)} ${y(-3.7)} L${x(0.55)} ${y(1.5)} L${x(-0.55)} ${y(1.5)} Z`}
      />
      <circle cx={cx} cy={7 + 3.0 * k} r={0.95 * k} />
    </>
  )
}

// A single question mark centred at `cx`; the hook is a stroked curve, the dot
// a circle. `k` scales geometry and stroke weight together.
function Ques(cx: number, k: number): JSX.Element {
  const x = (rx: number) => (cx + rx * k).toFixed(2)
  const y = (ry: number) => (7 + ry * k).toFixed(2)
  return (
    <>
      <path
        d={
          `M${x(-1.6)} ${y(-1.9)} Q${x(-1.6)} ${y(-3.6)} ${x(0)} ${y(-3.6)}` +
          ` Q${x(1.7)} ${y(-3.6)} ${x(1.7)} ${y(-1.8)}` +
          ` Q${x(1.7)} ${y(-0.4)} ${x(0.1)} ${y(0.6)}` +
          ` Q${x(-0.3)} ${y(0.9)} ${x(-0.3)} ${y(1.7)}`
        }
        fill="none"
        stroke="white"
        strokeWidth={1.5 * k}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={cx - 0.3 * k} cy={7 + 3.2 * k} r={0.95 * k} />
    </>
  )
}

const PAIR = 0.72 // scale for one mark of a two-mark glyph
const SHAPE: Record<Classification, JSX.Element> = {
  // ── Punctuation, composed from the two primitives above ──
  brilliant: <>{Excl(5.25, PAIR)}{Excl(8.75, PAIR)}</>,
  great:     Excl(7, 1.0),
  inaccuracy:<>{Ques(5.25, PAIR)}{Excl(8.75, PAIR)}</>,
  mistake:   Ques(7, 1.0),
  blunder:   <>{Ques(5.25, PAIR)}{Ques(8.75, PAIR)}</>,

  // ── Pictographs ──
  // Open book — two pages meeting at a central spine.
  book: (
    <path
      d="M7 4.6 Q4.6 3.4 2.6 3.9 L2.6 10 Q4.6 9.5 7 10.7 Z
         M7 4.6 Q9.4 3.4 11.4 3.9 L11.4 10 Q9.4 9.5 7 10.7 Z"
    />
  ),
  // Diamond — the engine's own move.
  best: <path d="M7 3.2 L10.8 7 L7 10.8 L3.2 7 Z" />,
  // Upward chevron — strong, just short of the top move.
  excellent: (
    <path
      d="M3.8 8.6 L7 5.4 L10.2 8.6"
      fill="none"
      stroke="white"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Dot — fine, nothing to say.
  good: <circle cx="7" cy="7" r="2.1" />,
  // Empty ring — the target was there, the move went past it.
  miss: <circle cx="7" cy="7" r="2.9" fill="none" stroke="white" strokeWidth="1.8" />,
  // Right-pointing arrow — "pushed into the move," the only legal one.
  forced: (
    <path
      d="M3.6 7 L9.6 7 M6.8 4.2 L9.6 7 L6.8 9.8"
      fill="none"
      stroke="white"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
}

export default function MoveClassificationIcon({ classification }: Props) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      data-classification={classification}
      style={{ color: `var(--review-${classification})` }}
      aria-label={classification}
    >
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <g fill="white">{SHAPE[classification]}</g>
    </svg>
  )
}
