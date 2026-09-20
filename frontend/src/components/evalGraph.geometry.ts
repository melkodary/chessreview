import type { MoveReview } from '../api/review'

export interface Point {
  x: number
  y: number
}

// Mover-POV win chance → White's point of view: the value flips every ply.
// Shared with provisional points, which use the same convention and are the
// reason this is separable from the MoveReview wrapper below.
export function whitePovAt(ply: number, winAfterPlayed: number): number {
  return ply % 2 === 1 ? winAfterPlayed : 100 - winAfterPlayed
}

// As above, plus the book flattening — which provisional points cannot do,
// since they carry no classification (a known, accepted artifact).
export function whitePovWin(move: MoveReview): number {
  if (move.classification === 'book') return 50
  return whitePovAt(move.ply, move.winAfterPlayed)
}

// Win chance (0..100, clamped) → y within a graph of the given height.
// 100 (White winning) sits at the top (y=0), 0 at the bottom (y=height).
export function yForWin(win: number, height: number): number {
  const clamped = Math.max(0, Math.min(100, win))
  return height * (1 - clamped / 100)
}

const n = (v: number) => Number(v.toFixed(2))

// Smoothed open curve through the points (Catmull-Rom → cubic bézier).
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${n(points[0].x)},${n(points[0].y)}`

  let d = `M ${n(points[0].x)},${n(points[0].y)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? points[i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(p2.x)},${n(p2.y)}`
  }
  return d
}

// Closed path: the smoothed curve, then down to the baseline and back, for the
// two-tone fill below the curve.
export function areaPath(points: Point[], height: number): string {
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${smoothPath(points)} L ${n(last.x)},${n(height)} L ${n(first.x)},${n(height)} Z`
}
