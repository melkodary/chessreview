import { useOutletContext } from 'react-router-dom'
import type { Arrow } from 'react-chessboard'
import type { Game } from '../api/types'
import type { Classification } from '../api/review'
import type { PositionStep } from '../hooks/useGameViewer'
import type { ExploreNode } from '../hooks/useBoardExploration'

// A board badge over a played square: either a graded verdict, or a pending
// spinner while a branch ply is still being graded (phase-2 board pending fix).
export type BoardBadge =
  | { square: string; classification: Classification }
  | { square: string; pending: true }

export interface BoardOverlay {
  arrows: Arrow[]
  badge?: BoardBadge
  // `stale`: the number describes a position the board has already left.
  // Dimmed, not hidden — hiding flickers, undimmed asserts it is current.
  evalBar: { evaluation: number; mate: number | null; stale?: boolean } | null
}

export interface AnalysisStatus {
  depth: number
  settled: boolean
}

export interface GameShellContext {
  game: Game
  username: string
  positions: PositionStep[]
  moveIndex: number
  goTo: (index: number) => void
  currentFen: string
  isUserWhite: boolean
  setBoardOverlay: (overlay: BoardOverlay | null) => void
  setAnalysisStatus: (status: AnalysisStatus | null) => void
  // Analysis-mode variation exploration (inert in Review).
  exploring: boolean
  branch: ExploreNode[]
  branchIndex: number
  resetExploration: () => void
  selectBranch: (lineIndex: number) => void
  branchBack: () => void
  branchForward: () => void
  playExplorationUci: (uci: string) => boolean
}

export function useGameShell(): GameShellContext {
  return useOutletContext<GameShellContext>()
}
