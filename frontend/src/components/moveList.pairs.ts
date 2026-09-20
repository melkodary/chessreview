export interface Pair {
  moveNum: number
  whiteIdx: number
  blackIdx: number | null
}

// Group ply indices into (white, black) rows for the move list. blackIdx is
// null on a final unanswered white move.
export function buildPairs(moveCount: number): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < moveCount; i += 2) {
    pairs.push({
      moveNum: Math.floor(i / 2) + 1,
      whiteIdx: i + 1,
      blackIdx: i + 2 <= moveCount ? i + 2 : null,
    })
  }
  return pairs
}
