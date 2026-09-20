import { useMemo } from 'react'
import { Chess } from 'chess.js'
import { partialSummary } from '../reviewScoreboard'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useSettings } from '../settingsContext'
import { routes } from '../router'
import MoveList from '../components/MoveList'
import NavRow from './NavRow'
import ReviewGuide from '../components/ReviewGuide'
import ReviewSummary from '../components/ReviewSummary'
import ReviewIntro from '../components/ReviewIntro'
import ReviewProgress from '../components/ReviewProgress'
import EvalGraph from '../components/EvalGraph'
import { useGameShell } from './gameShellContext'
import { useReviewOverlay } from './useReviewOverlay'
import { useReview } from './reviewContext'
import { reviewBadge } from '../reviewBadge'
import { tryMove } from '../chessMove'
import type { ExplainMoveRequest, MoveReview } from '../api/review'
import ExplorationBanner from './ExplorationBanner'
import { explainPrev } from './explainPrev'
import { useMoveExplanation } from '@private'
import styles from './viewer.module.css'

export default function ReviewPanel() {
  const {
    game, positions, moveIndex, goTo, currentFen, isUserWhite,
    exploring, branch, branchIndex, resetExploration,
    selectBranch, branchBack, branchForward,
  } = useGameShell()
  const { userId, gameId } = useParams() as { userId: string; gameId: string }
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { reviewDepth, reviewMultiPv } = useSettings()

  const {
    state, moves, summary, displayedConfig, totalPlies, error, swept, engineSource,
    start, cancel, reviewView, setReviewView, branchGrades, provisional,
  } = useReview()

  const done = state === 'done' && summary != null
  const inWalkthrough = done && reviewView === 'walkthrough'
  const rerunMatchesSettings =
    displayedConfig?.depth === reviewDepth &&
    displayedConfig.multipv === reviewMultiPv

  // Branch grading itself runs in ReviewProvider (above the Outlet, so verdicts
  // survive a tab flip); this panel only renders what it produced.
  const forkFen = positions[moveIndex]?.fen ?? positions[0].fen
  // The current branch ply's verdict → board badge (branchIndex 0 = the fork).
  // A pending ply shows a spinner over the moved piece (not nothing), mirroring
  // the MoveList row — the board and the list agree on grading state.
  const branchBadge = useMemo(() => {
    if (!exploring || branchIndex < 1) return undefined
    const j = branchIndex - 1
    const grade = branchGrades[j]
    if (!grade) return undefined
    if (grade.status === 'done' && grade.review) return reviewBadge(grade.review)
    if (grade.status === 'pending') {
      const predFen = j === 0 ? forkFen : branch[j - 1].fen
      const played = tryMove(predFen, branch[j].san)
      return played ? { square: played.to, pending: true as const } : undefined
    }
    return undefined
  }, [exploring, branchIndex, branchGrades, branch, forkFen])
  const listGrades = useMemo(
    () => branchGrades.map((g) => ({ status: g.status, classification: g.review?.classification })),
    [branchGrades],
  )

  const explainRequests = useMemo<{
    initial: ExplainMoveRequest
    engine: ExplainMoveRequest
  } | undefined>(() => {
    let fenBefore: string | undefined
    let san: string | null | undefined
    let storedMove: MoveReview | undefined
    let prevBeforeEval: number | undefined
    // The ply before the one being explained, for great's non-obviousness gate.
    let prevFen: string | undefined
    let prevSan: string | null | undefined

    if (exploring && branchIndex > 0) {
      const index = branchIndex - 1
      fenBefore = index === 0 ? forkFen : branch[index - 1]?.fen
      san = branch[index]?.san
      storedMove = branchGrades[index]?.review
      prevBeforeEval = index === 0
        ? moves[moveIndex - 1]?.evalBefore
        : branchGrades[index - 1]?.review?.evalBefore
      // At the branch root the previous ply is the main line's own move.
      prevFen = index === 0 ? positions[moveIndex - 1]?.fen
        : index === 1 ? forkFen : branch[index - 2]?.fen
      prevSan = index === 0 ? positions[moveIndex]?.san : branch[index - 1]?.san
    } else if (moveIndex > 0) {
      fenBefore = positions[moveIndex - 1]?.fen
      san = positions[moveIndex]?.san
      storedMove = moves[moveIndex - 1]
      prevBeforeEval = moves[moveIndex - 2]?.evalBefore
      prevFen = positions[moveIndex - 2]?.fen
      prevSan = positions[moveIndex - 1]?.san
    }

    if (!fenBefore || !san) return undefined
    // Its own try: an unusable previous ply degrades to "not supplied", which
    // the backend reads as unknown — it must not lose the whole explanation.
    const prev = explainPrev(prevFen, prevSan)
    try {
      const played = new Chess(fenBefore).move(san)
      const engine: ExplainMoveRequest = {
        fenBefore,
        uci: played.from + played.to + (played.promotion ?? ''),
        whiteElo: game.white.rating,
        blackElo: game.black.rating,
        depth: reviewDepth,
        multipv: reviewMultiPv,
        prevBeforeEval,
        ...prev,
      }
      const initial: ExplainMoveRequest = storedMove
        ? {
            move: storedMove,
            whiteElo: game.white.rating,
            blackElo: game.black.rating,
            prevBeforeEval,
            ...prev,
          }
        : engine
      return { initial, engine }
    } catch {
      return undefined
    }
  }, [
    exploring, branchIndex, branch, branchGrades, forkFen, moves, moveIndex,
    positions, game.white.rating, game.black.rating, reviewDepth, reviewMultiPv,
  ])

  const explanation = useMoveExplanation({
    initialRequest: explainRequests?.initial,
    regradeRequest: explainRequests?.engine,
  })

  const { reviewMap, current } = useReviewOverlay(moves, moveIndex, {
    done, walkthrough: inWalkthrough, exploring, branchBadge, branchGrades, branchIndex,
  })

  const handleCancel = () => {
    cancel()
    navigate(routes.analyze(
      game.source, userId, gameId, moveIndex, params.get('before') ?? undefined,
    ))
  }

  const startReview = () => {
    setReviewView('walkthrough')
    goTo(1)
  }

  const moveList = (
    <MoveList
      positions={positions}
      currentIndex={moveIndex}
      onSelect={goTo}
      reviews={reviewMap}
      {...(exploring ? {
        branch,
        branchIndex,
        deviationPly: moveIndex,
        onSelectBranch: selectBranch,
        branchGrades: listGrades,
      } : {})}
    />
  )

  const navRow = (
    <NavRow
      onFirst={() => goTo(0)}
      onPrev={exploring ? branchBack : () => goTo(moveIndex - 1)}
      onNext={exploring ? branchForward : () => goTo(moveIndex + 1)}
      onLast={() => goTo(positions.length - 1)}
      atStart={moveIndex === 0}
      atEnd={moveIndex === positions.length - 1}
      prevDisabled={exploring ? branchIndex === 0 : undefined}
      nextDisabled={exploring ? branchIndex >= branch.length : undefined}
      fen={currentFen}
      pgn={game.pgn}
      onExplain={explanation.open}
    />
  )

  // Estimates only while the review is still filling in — once it's done every
  // ply has an authoritative point and the provisional array has nothing left
  // to contribute.
  const graphTop = (
    <div className={styles.graphTop}>
      <EvalGraph
        moves={moves}
        totalPlies={totalPlies}
        currentPly={moveIndex}
        onJump={goTo}
        provisional={state === 'running' ? provisional : undefined}
      />
    </div>
  )

  const liveSummary = useMemo(() => partialSummary(moves), [moves])

  // Deviating from the game line: a focused branch view with live per-ply
  // verdicts (graded above). Supersedes the summary/walkthrough/idle screens
  // while exploring — the branch is shared across tabs; here it earns badges.
  if (exploring) {
    return (
      <>
        <ExplorationBanner onReset={resetExploration} />
        {moveList}
        {navRow}
        {explanation.modal}
      </>
    )
  }

  // Running: live scoreboard (counts tick up; board + nav stay usable). No move
  // list here — it only appears in the walkthrough, so the summary view (both
  // the live and the done version) doesn't yank the list in and out on finish.
  if (state === 'running') {
    return (
      <>
        <ReviewProgress reviewed={Math.max(moves.length, swept)} total={totalPlies} onCancel={handleCancel} />
        {graphTop}
        <div className={styles.summaryScroll}>
          <ReviewSummary
            summary={liveSummary}
            whiteName={game.white.username}
            blackName={game.black.username}
            isUserWhite={isUserWhite}
            engineSource={engineSource}
          />
        </div>
        {navRow}
        {explanation.modal}
      </>
    )
  }

  // Done: existing two-screen flow (summary → guided walkthrough)
  if (done) {
    return (
      <>
        {reviewView === 'summary' && (
          <>
            {graphTop}
            <div className={styles.summaryScroll}>
              <ReviewSummary
                summary={summary}
                whiteName={game.white.username}
                blackName={game.black.username}
                isUserWhite={isUserWhite}
                engineSource={engineSource}
              />
            </div>
            <div className={styles.startRow}>
              <button
                className={styles.rerunBtn}
                onClick={start}
                disabled={rerunMatchesSettings}
                aria-label="Re-run review"
                title={
                  rerunMatchesSettings
                    ? 'Review already matches these settings. Change settings to re-run.'
                    : 'Re-run review'
                }
              >
                ↻
              </button>
              <button className={styles.startBtn} onClick={startReview}>Start Review →</button>
            </div>
          </>
        )}

        {inWalkthrough && (
          <>
            <div className={styles.walkHeader}>
              <button className={styles.walkBack} onClick={() => setReviewView('summary')}>← Summary</button>
            </div>
            <ReviewGuide move={current} />
            {moveList}
            <div className={styles.miniGraph}>
              <EvalGraph moves={moves} totalPlies={totalPlies} currentPly={moveIndex} onJump={goTo} compact />
            </div>
            {navRow}
            {explanation.modal}
          </>
        )}
      </>
    )
  }

  // Idle (post-cancel) or error: hero card with manual start
  return (
    <>
      <ReviewIntro
        onStart={start}
        error={state === 'error' ? error : undefined}
        depth={reviewDepth}
        lines={reviewMultiPv}
      />
    </>
  )
}
