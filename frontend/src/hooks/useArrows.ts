import { useMemo } from 'react'
import { Chess } from 'chess.js'
import type { Arrow } from 'react-chessboard'
import type { AnalysisLine } from '../api/analyzer'
import { hexToRgba } from '../color'

const ARROW_COLOR = '#81b64c'  // matches --review-best
const OPACITIES = [1.0, 0.6, 0.3]

export function useArrows(
  fen: string,
  lines: AnalysisLine[],
): Arrow[] {
  return useMemo(() => {
    if (lines.length === 0) return []
    const arrows: Arrow[] = []
    for (let i = 0; i < Math.min(lines.length, OPACITIES.length); i++) {
      const san = lines[i].moves[0]
      if (!san) continue
      try {
        const chess = new Chess(fen)
        const move = chess.move(san)
        arrows.push({
          startSquare: move.from,
          endSquare: move.to,
          color: hexToRgba(ARROW_COLOR, OPACITIES[i]),
        })
      } catch {
        // stale analysis for this fen — skip arrow
      }
    }
    return arrows
  }, [fen, lines])
}
