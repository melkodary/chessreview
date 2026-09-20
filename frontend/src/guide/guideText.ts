import type { Classification, MoveReview } from '../api/review'

export interface GuideText {
  describe(m: MoveReview): string
  // v2: detail?(m: MoveReview): string  — deeper "Explain" reasoning
}

// Noun phrases with the correct article, for moves named by quality.
const LABEL: Record<Classification, string> = {
  book: 'still in book',
  forced: 'forced — the only legal move',
  brilliant: 'a brilliant move',
  great: 'a great move',
  best: 'a strong move',
  excellent: 'an excellent move',
  good: 'a good move',
  inaccuracy: 'an inaccuracy',
  mistake: 'a mistake',
  blunder: 'a blunder',
  miss: 'a miss',
}

// Mistakes — these name the engine's preferred move.
const NAMES_BEST: Classification[] = ['inaccuracy', 'mistake', 'blunder', 'miss']

export const heuristicGuide: GuideText = {
  describe(m: MoveReview): string {
    const { san, bestMoveSan, classification: c } = m

    if (c === 'book') return `${san} — still in book`
    if (c === 'forced') return `${san} was forced — the only legal move`
    if (c === 'brilliant') return `${san} is a brilliant move`
    if (c === 'great') return `${san} is a great move`
    if (san === bestMoveSan) return `${san} is the best move`

    const base = `${san} is ${LABEL[c]}`
    return NAMES_BEST.includes(c) ? `${base} — best was ${bestMoveSan}` : base
  },
}
