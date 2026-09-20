import type { MoveReview } from '../api/review'
import type { GuideText } from '../guide/guideText'
import GuideBubble from './GuideBubble'

interface Props {
  move: MoveReview | null
  guide?: GuideText
}

// Growth seam for the review guide. v1 = the coach bubble; v2 will add the
// key-moment navigator, "Best" toggle, and "Explain" detail here.
export default function ReviewGuide({ move, guide }: Props) {
  if (move == null) return null
  return <GuideBubble move={move} guide={guide} />
}
