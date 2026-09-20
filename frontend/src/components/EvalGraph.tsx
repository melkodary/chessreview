import { useMemo, useRef, useState } from 'react'

import type { MoveReview, ProvisionalPoint } from '../api/review'
import { formatMoveEval } from '../eval'
import type { Point } from './evalGraph.geometry'
import { whitePovAt, whitePovWin, yForWin, smoothPath, areaPath } from './evalGraph.geometry'
import styles from './EvalGraph.module.css'

interface Props {
  moves: MoveReview[]
  totalPlies: number
  currentPly: number
  onJump: (ply: number) => void
  compact?: boolean
  // Browser-estimated points for plies the running review hasn't reached yet.
  // Mover-POV like MoveReview.winAfterPlayed, so they need no special geometry.
  provisional?: ProvisionalPoint[]
}

// A fresh `[]` default would change reference every render and defeat the merge
// memo below.
const NO_PROVISIONAL: ProvisionalPoint[] = []

const W = 100
const H = 30

interface Plotted {
  ply: number
  win: number
  move?: MoveReview // absent ⇒ provisional
}

export default function EvalGraph({
  moves, totalPlies, currentPly, onJump, compact = false, provisional = NO_PROVISIONAL,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  // Merge by ply, authoritative always winning: an estimate exists only to fill
  // a ply the backend has not produced yet, and is replaced the moment it does.
  const merged = useMemo<Plotted[]>(() => {
    const byPly = new Map<number, Plotted>()
    for (const p of provisional) {
      byPly.set(p.ply, { ply: p.ply, win: whitePovAt(p.ply, p.winAfterPlayed) })
    }
    for (const m of moves) byPly.set(m.ply, { ply: m.ply, win: whitePovWin(m), move: m })
    return [...byPly.values()].sort((a, b) => a.ply - b.ply)
  }, [moves, provisional])

  // x from the ply, not the array index: with estimates merged in, the array is
  // no longer guaranteed to start at ply 1 and run contiguously.
  const xFor = (ply: number) => (totalPlies > 1 ? ((ply - 1) / (totalPlies - 1)) * W : W / 2)
  const toPoint = (p: Plotted): Point => ({ x: xFor(p.ply), y: yForWin(p.win, H) })

  const points: Point[] = merged.map(toPoint)
  // The solid curve is drawn over the merged one, so where the review has
  // arrived it hides the estimate underneath and the dashes survive only ahead
  // of it — no segment splitting, no seam at the boundary.
  const solidPoints: Point[] = merged.filter((p) => p.move).map(toPoint)
  const hasProvisional = merged.some((p) => !p.move)

  const cursorX = totalPlies > 1
    ? Math.max(0, Math.min(1, (currentPly - 1) / (totalPlies - 1))) * W
    : W / 2

  function indexFromEvent(e: React.MouseEvent<SVGSVGElement>): number | null {
    if (!ref.current || merged.length === 0) return null
    const rect = ref.current.getBoundingClientRect()
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 1
    return Math.max(0, Math.min(merged.length - 1, Math.round(frac * (merged.length - 1))))
  }

  const hovered = hover != null ? merged[hover] : null
  const hoverPoint = hover != null ? points[hover] : null

  return (
    <div className={styles.wrap}>
      <svg
        ref={ref}
        className={`${styles.svg} ${compact ? styles.compact : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onClick={(e) => { const i = indexFromEvent(e); if (i != null) onJump(merged[i].ply) }}
        onMouseMove={(e) => setHover(indexFromEvent(e))}
        onMouseLeave={() => setHover(null)}
      >
        <path data-testid="eval-area" className={styles.area} d={areaPath(points, H)} />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className={styles.mid} />
        {hasProvisional && (
          <path
            data-testid="eval-curve-provisional"
            className={styles.curveProvisional}
            d={smoothPath(points)}
          />
        )}
        <path data-testid="eval-curve" className={styles.curve} d={smoothPath(solidPoints)} />
        <line
          data-testid="eval-cursor"
          className={styles.cursor}
          x1={cursorX}
          y1="0"
          x2={cursorX}
          y2={H}
        />
        {hoverPoint && (
          <circle className={styles.marker} cx={hoverPoint.x} cy={hoverPoint.y} r={1.4} />
        )}
      </svg>
      {/* No readout on an estimate: a precise +0.42 that later changes is the
          one claim this graph must not make. */}
      {hovered?.move && hoverPoint && (
        <div
          className={styles.tooltip}
          style={{ left: `${hoverPoint.x}%`, top: `${(hoverPoint.y / H) * 100}%` }}
        >
          {formatMoveEval(hovered.move.evalAfterPlayed, hovered.move.mateAfterPlayed)}
        </div>
      )}
    </div>
  )
}
