import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'

// Per-square overlay markers. Tokens resolve per skin via the inherited CSS vars.
const DOT = 'radial-gradient(circle, var(--hint-dot) 0 19%, transparent 20%)'
const RING =
  'radial-gradient(circle closest-side, transparent 0 84%, var(--hint-ring) 85% 94%, transparent 95%)'

// Style map for a picked-up square's legal targets: a tint on the pickup square,
// a dot on quiet targets, a ring on capturable ones. Empty for no/empty/off-turn
// square. Promotions dedup naturally (four moves, same `to`, same style).
export function buildLegalTargetStyles(
  fen: string,
  square: string | null,
): Record<string, CSSProperties> {
  if (!square) return {}
  const moves = new Chess(fen).moves({ square: square as Square, verbose: true }) // [] if no piece / not its turn
  if (moves.length === 0) return {}
  const styles: Record<string, CSSProperties> = { [square]: { background: 'var(--hint-pickup)' } }
  for (const m of moves) {
    const isCapture = m.flags.includes('c') || m.flags.includes('e') // capture / en passant
    styles[m.to] = { background: isCapture ? RING : DOT } // last write wins; same target → same style
  }
  return styles
}
