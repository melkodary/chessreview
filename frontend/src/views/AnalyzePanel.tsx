import { useEffect, useMemo } from 'react'
import { Chess } from 'chess.js'
import { useSettings } from '../settingsContext'
import { useStreamingAnalysis } from '../hooks/useStreamingAnalysis'
import { useArrows } from '../hooks/useArrows'
import { reviewBadge } from '../reviewBadge'
import MoveList from '../components/MoveList'
import NavRow from './NavRow'
import BestLines from '../components/BestLines'
import { useGameShell } from './gameShellContext'
import type { BoardOverlay } from './gameShellContext'
import { useBoardOverlay } from './useBoardOverlay'
import { useReviewMap, useCurrentReview } from './reviewDerivations'
import { useReview } from './reviewContext'
import type { ExplainMoveRequest } from '../api/review'
import ExplorationBanner from './ExplorationBanner'
import { explainPrev } from './explainPrev'
import { useMoveExplanation } from '@private'

export default function AnalyzePanel() {
  const {
    game, positions, moveIndex, goTo, currentFen, isUserWhite,
    setAnalysisStatus,
    exploring, branch, branchIndex,
    resetExploration, selectBranch, branchBack, branchForward,
    playExplorationUci,
  } = useGameShell()
  const {
    analysisTimeMs,
    analysisLines,
    engineThreads,
    engineHash,
    reviewDepth,
    reviewMultiPv,
  } = useSettings()
  // Analysis never starts a review — it only reads whatever ReviewProvider has
  // hydrated (or is streaming in) for this game.
  const { moves: reviewMoves } = useReview()

  const {
    displayLines,
    freshCount,
    currentDepth,
    loading: analyzing,
    error: analysisError,
  } = useStreamingAnalysis(
    currentFen,
    analysisTimeMs,
    analysisLines,
    engineThreads,
    engineHash,
    moveIndex > 0 || branchIndex > 0,
  )
  useEffect(() => {
    setAnalysisStatus(
      !analysisError && currentDepth > 0
        ? { depth: currentDepth, settled: !analyzing }
        : null,
    )
  }, [analysisError, analyzing, currentDepth, setAnalysisStatus])
  useEffect(() => () => setAnalysisStatus(null), [setAnalysisStatus])

  // Only the fresh prefix is trusted for the board — arrows for a carried line,
  // none for held stale ones. Memoised: useArrows keys on array identity, so a
  // fresh slice per render would re-run the overlay effect forever.
  const freshLines = useMemo(
    () => displayLines.slice(0, freshCount),
    [displayLines, freshCount],
  )
  // The display channel already holds the last known eval across the gap, so the
  // bar reads it directly; the fallback covers "nothing has ever been held".
  const top = displayLines[0]
  const topEval = top?.evaluation ?? 0
  const topMate = top?.mate ?? null
  const arrows = useArrows(currentFen, freshLines)

  const reviewMap = useReviewMap(reviewMoves)
  const current = useCurrentReview(reviewMoves, moveIndex)
  // Deviate from the game line and the badge disappears — a branch position
  // has no review data, and a badge left on screen would read as a verdict
  // on the move just played.
  const badge = useMemo(
    () => (exploring ? undefined : reviewBadge(current)),
    [exploring, current],
  )

  const overlay = useMemo<BoardOverlay>(() => ({
    arrows, badge, evalBar: { evaluation: topEval, mate: topMate, stale: freshCount === 0 },
  }), [arrows, badge, topEval, topMate, freshCount])
  useBoardOverlay(overlay)

  const explainRequest = useMemo<ExplainMoveRequest | undefined>(() => {
    let fenBefore: string | undefined
    let san: string | null | undefined
    // The ply before the one being explained, for great's non-obviousness gate.
    let prevFen: string | undefined
    let prevSan: string | null | undefined
    if (exploring && branchIndex > 0) {
      fenBefore = branchIndex === 1 ? positions[moveIndex]?.fen : branch[branchIndex - 2]?.fen
      san = branch[branchIndex - 1]?.san
      // At the branch root the previous ply is the main line's own move.
      prevFen = branchIndex === 1 ? positions[moveIndex - 1]?.fen
        : branchIndex === 2 ? positions[moveIndex]?.fen : branch[branchIndex - 3]?.fen
      prevSan = branchIndex === 1 ? positions[moveIndex]?.san : branch[branchIndex - 2]?.san
    } else if (moveIndex > 0) {
      fenBefore = positions[moveIndex - 1]?.fen
      san = positions[moveIndex]?.san
      prevFen = positions[moveIndex - 2]?.fen
      prevSan = positions[moveIndex - 1]?.san
    }
    if (!fenBefore || !san) return undefined
    try {
      const move = new Chess(fenBefore).move(san)
      return {
        fenBefore,
        uci: move.from + move.to + (move.promotion ?? ''),
        whiteElo: game.white.rating,
        blackElo: game.black.rating,
        depth: reviewDepth,
        multipv: reviewMultiPv,
        ...explainPrev(prevFen, prevSan),
      }
    } catch {
      return undefined
    }
  }, [
    exploring, branchIndex, branch, positions, moveIndex, game.white.rating,
    game.black.rating, reviewDepth, reviewMultiPv,
  ])

  const explanation = useMoveExplanation({ initialRequest: explainRequest })

  return (
    <>
      <BestLines
        lines={displayLines}
        loading={analyzing}
        error={!!analysisError}
        freshCount={freshCount}
        rows={analysisLines}
        flipped={!isUserWhite}
        onSelectLine={(line) => {
          const uci = line.pvUci?.[0]
          if (uci) playExplorationUci(uci)
        }}
      />

      {exploring && (
        <ExplorationBanner onReset={resetExploration} />
      )}

      <MoveList
        positions={positions}
        currentIndex={moveIndex}
        onSelect={goTo}
        reviews={reviewMap}
        branch={branch}
        branchIndex={branchIndex}
        deviationPly={moveIndex}
        onSelectBranch={selectBranch}
      />

      <NavRow
        onFirst={() => goTo(0)}
        onPrev={exploring ? branchBack : () => goTo(moveIndex - 1)}
        onNext={exploring ? branchForward : () => goTo(moveIndex + 1)}
        onLast={() => goTo(positions.length - 1)}
        atStart={moveIndex === 0}
        atEnd={moveIndex === positions.length - 1}
        prevDisabled={!exploring && moveIndex === 0}
        nextDisabled={!exploring && moveIndex === positions.length - 1}
        fen={currentFen}
        pgn={game.pgn}
        onExplain={explanation.open}
      />

      {explanation.modal}
    </>
  )
}
