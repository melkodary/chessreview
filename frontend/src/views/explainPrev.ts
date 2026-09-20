import { Chess } from 'chess.js'

/** The opponent's last move, in the shape `explainMove` sends it.
 *
 * Empty when either half is missing or the pair does not parse — the field is
 * optional on every explain form, and the backend reads an absent previous move
 * as unknown rather than as "not a recapture". */
export function explainPrev(
  prevFen: string | undefined,
  prevSan: string | null | undefined,
): { prevFen?: string; prevUci?: string } {
  if (!prevFen || !prevSan) return {}
  try {
    const move = new Chess(prevFen).move(prevSan)
    return { prevFen, prevUci: move.from + move.to + (move.promotion ?? '') }
  } catch {
    return {}
  }
}
