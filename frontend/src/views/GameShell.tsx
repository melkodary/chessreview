import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Game } from '../api/types'
import { asSource } from '../api/sources'
import { useGame } from '../hooks/useGame'
import { useGameViewer } from '../hooks/useGameViewer'
import { useBoardExploration } from '../hooks/useBoardExploration'
import { useKeyboardNav } from '../hooks/useKeyboardNav'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { routes } from '../router'
import Board from '../components/Board'
import EvalBar from '../components/EvalBar'
import PlayerChip from '../components/PlayerChip'
import StatusScreen from '../components/StatusScreen'
import type { AnalysisStatus, BoardOverlay, GameShellContext } from './gameShellContext'
import { ReviewProvider } from './ReviewProvider'
import styles from './viewer.module.css'

function playerFrom(side: Game['white']) {
  return {
    name: side.username,
    rating: side.rating != null ? String(side.rating) : undefined,
  }
}

function tabClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
}

export default function GameShell() {
  const { userId, gameId } = useParams() as { userId: string; gameId: string }
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const moveParam = Number(params.get('move') ?? '0')
  const requestedMove = Number.isFinite(moveParam) && moveParam >= 0 ? Math.floor(moveParam) : 0
  const source = asSource(params.get('source'))
  const before = params.get('before') ?? undefined
  const navigate = useNavigate()

  const { data: game, loading, error } = useGame(source, userId, gameId)
  const [overlay, setOverlay] = useState<BoardOverlay | null>(null)
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null)
  const replaceMove = useCallback((move: number) => {
    const next = new URLSearchParams(params)
    next.set('move', String(move))
    setParams(next, { replace: true })
  }, [params, setParams])
  // useGameViewer must run every render; '' yields just the start position.
  const { positions, moveIndex, goTo } = useGameViewer(
    game?.pgn ?? '',
    requestedMove,
    replaceMove,
  )

  useEffect(() => {
    if (game && params.get('move') !== String(moveIndex)) replaceMove(moveIndex)
  }, [game, moveIndex, params, replaceMove])

  // Variation exploration overlays the fixed game line (Analysis only). The hook
  // runs every render (Rules of Hooks); it's harmless in Review since GameShell
  // wires its drag handlers to the board only on the Analyze route.
  const baseFen = positions[moveIndex]?.fen ?? positions[0].fen
  const tab = pathname.endsWith('/analyze') ? 'Analysis' : 'Review'
  const exploration = useBoardExploration({ baseFen, moveIndex, pgn: game?.pgn ?? '', tab })

  // One keyboard owner: ←/→ drive the branch while exploring, else the game line.
  useKeyboardNav({
    left: exploration.exploring ? exploration.back : () => goTo(moveIndex - 1),
    right: exploration.exploring ? exploration.forward : () => goTo(moveIndex + 1),
  })

  // Deviating is available on both tabs and no longer switches them, but the
  // branch carries asymmetrically (useBoardExploration owns the rule): Review →
  // Analysis carries it, so a variation graded ply-by-ply on Review can be poked
  // at with engine lines; Analysis → Review restores the branch as Review last
  // saw it. Analysis is a scratchpad — plies wandered there must not arrive in
  // Review wearing grade badges. Game navigation / a new game still clears both.

  useDocumentTitle(game ? `${tab} · ${game.white.username} vs ${game.black.username}` : undefined)

  if (loading) return <StatusScreen><p>Loading game…</p></StatusScreen>

  if (error || !game) {
    return (
      <StatusScreen>
        <p>{error || 'Game not found'}</p>
        <button onClick={() => navigate(routes.games(source, userId, before))}>Back to games</button>
      </StatusScreen>
    )
  }

  const isUserWhite = game.white.username.toLowerCase() === userId.toLowerCase()
  const topPlayer = isUserWhite ? playerFrom(game.black) : playerFrom(game.white)
  const bottomPlayer = isUserWhite ? playerFrom(game.white) : playerFrom(game.black)
  // Effective position: the explored tip when exploring, else the game node.
  const currentFen = exploration.effectiveFen

  const ctx: GameShellContext = {
    game,
    username: userId,
    positions,
    moveIndex,
    goTo,
    currentFen,
    isUserWhite,
    setBoardOverlay: setOverlay,
    setAnalysisStatus,
    exploring: exploration.exploring,
    branch: exploration.branch,
    branchIndex: exploration.branchIndex,
    resetExploration: exploration.reset,
    selectBranch: exploration.selectBranch,
    branchBack: exploration.back,
    branchForward: exploration.forward,
    playExplorationUci: exploration.playUci,
  }

  return (
    <div className={styles.root}>
      <div className={styles.boardPanel} data-testid="board-panel">
        <div className={styles.playerRow}>
          <PlayerChip name={topPlayer.name} rating={topPlayer.rating} />
        </div>
        <div className={styles.boardRow}>
          {overlay?.evalBar ? (
            <EvalBar
              evaluation={overlay.evalBar.evaluation}
              mate={overlay.evalBar.mate}
              stale={overlay.evalBar.stale}
              flipped={!isUserWhite}
            />
          ) : (
            <div className={styles.evalBarGutter} aria-hidden="true" />
          )}
          <Board
            fen={currentFen}
            flipped={!isUserWhite}
            arrows={overlay?.arrows ?? []}
            badge={overlay?.badge}
            interactive
            onPieceDrop={exploration.onPieceDrop}
            canDragPiece={exploration.canDragPiece}
            onSquareClick={exploration.onSquareClick}
            onPieceDrag={exploration.onPieceDrag}
            squareStyles={exploration.squareStyles}
          />
        </div>
        <div className={styles.playerRow}>
          <PlayerChip name={bottomPlayer.name} rating={bottomPlayer.rating} />
        </div>
      </div>

      <div className={styles.sidePanel} data-testid="side-panel">
        <nav className={styles.tabs}>
          <NavLink to={routes.review(source, userId, gameId, moveIndex, before)} className={tabClass} end>Review</NavLink>
          <NavLink to={routes.analyze(source, userId, gameId, moveIndex, before)} className={tabClass} end>
            Analysis
            {analysisStatus && (
              <span
                className={`${styles.depthBadge} ${analysisStatus.settled ? styles.depthBadgeSettled : ''}`}
                data-testid="depth-badge"
                aria-hidden="true"
                title={`Analysis depth ${analysisStatus.depth}`}
              >
                {`D${analysisStatus.depth}`}
              </span>
            )}
          </NavLink>
        </nav>
        <ReviewProvider
          pgn={game.pgn}
          meta={{
            source, userId, gameId,
            whiteElo: game.white.rating, blackElo: game.black.rating,
          }}
          branch={exploration.branch}
          forkFen={baseFen}
          forkPly={moveIndex}
          gradingEnabled={exploration.exploring && tab === 'Review'}
          positions={positions}
          // The sweep yields the shared engine to every foreground consumer:
          // branch grading while exploring, and the Analysis tab's own search.
          sweepEnabled={!exploration.exploring && tab === 'Review'}
        >
          <Outlet context={ctx} />
        </ReviewProvider>
      </div>
    </div>
  )
}
