import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chess } from 'chess.js'
import { buildLegalTargetStyles } from './legalTargetStyles'

export interface ExploreNode {
  fen: string
  san: string // SAN of the move that reached `fen` (empty for the fork node)
}

// Subset of react-chessboard handler arg shapes we consume.
interface PieceDropArgs { sourceSquare: string; targetSquare: string | null }
interface PieceDragArgs { piece: { pieceType: string }; square: string | null }
interface SquareClickArgs { piece: { pieceType: string } | null; square: string }

export type ExploreTab = 'Review' | 'Analysis'

interface Params {
  baseFen: string // positions[moveIndex].fen — the game node a branch deviates from
  moveIndex: number // game navigation: a change clears the branch
  pgn: string // new game: a change clears the branch
  tab: ExploreTab // Review → Analysis snapshots the branch; Analysis → Review restores it
}

interface BoardExploration {
  exploring: boolean
  effectiveFen: string // exploring ? line[index].fen : baseFen
  branch: ExploreNode[] // explored half-moves (line without the fork node)
  branchIndex: number // current node within the line; 0 = fork, k = after branch[k-1]
  canDragPiece: (args: PieceDragArgs) => boolean
  onPieceDrag: (args: PieceDragArgs) => void
  onPieceDrop: (args: PieceDropArgs) => boolean
  onSquareClick: (args: SquareClickArgs) => boolean // true only when a move was committed
  playUci: (uci: string) => boolean
  squareStyles: Record<string, CSSProperties> // legal-target hints for the picked-up square
  back: () => void
  forward: () => void
  reset: () => void
  selectBranch: (lineIndex: number) => void
}

function sideToMove(fen: string): string {
  return fen.split(' ')[1]
}

interface Branch {
  line: ExploreNode[]
  index: number
}

const EMPTY: Branch = { line: [], index: 0 }

export function useBoardExploration({ baseFen, moveIndex, pgn, tab }: Params): BoardExploration {
  // line[0] is the fork (the game node we deviated from); line[1..] are explored
  // half-moves. An empty line means "not exploring".
  const [line, setLine] = useState<ExploreNode[]>([])
  const [index, setIndex] = useState(0)
  // The tap-selected / drag-picked-up source square; drives the legal-target hints.
  const [pickupSquare, setPickupSquare] = useState<string | null>(null)
  // Review's branch, parked while the user is on Analysis. Analysis explores the
  // live branch freely; none of that survives the flip back (see restore below).
  const [snapshot, setSnapshot] = useState<Branch | null>(null)

  // One render-phase reconciliation for both lifecycle rules. We adjust state
  // during render (React's prop-change reset pattern) rather than in an effect,
  // so the change lands without a cascading second render — and in one block, so
  // the rest of the render reads a single source (`cur`) instead of chasing
  // shadows across two. Branch navigation moves `index` (not moveIndex/pgn/tab),
  // so it deliberately does not trigger this.
  const navKey = `${moveIndex}|${pgn}`
  const [prevNavKey, setPrevNavKey] = useState(navKey)
  const [prevTab, setPrevTab] = useState<ExploreTab>(tab)
  let cur: Branch = { line, index }
  let overridden = false
  if (navKey !== prevNavKey) {
    // Game navigation or a new game clears the branch — and the snapshot with
    // it, which is only meaningful at the fork ply it was taken from. Checked
    // first, so a nav that coincides with a tab flip wins.
    setPrevNavKey(navKey)
    setPrevTab(tab)
    setSnapshot(null)
    cur = EMPTY
    overridden = true
  } else if (tab !== prevTab) {
    setPrevTab(tab)
    if (tab === 'Analysis') {
      setSnapshot(cur) // leaving Review: park it, live branch carries over
    } else {
      cur = snapshot ?? EMPTY // entering Review: Analysis' edits are discarded
      setSnapshot(null)
      overridden = true
    }
  }
  if (overridden) {
    setLine(cur.line)
    setIndex(cur.index)
    setPickupSquare(null)
  }
  const curLine = cur.line
  const curIndex = cur.index
  const curPickup = overridden ? null : pickupSquare

  const exploring = curLine.length > 1
  const effectiveFen = exploring ? curLine[curIndex].fen : baseFen
  // Memoized, not sliced per render: consumers' badge memo feeds the board
  // overlay, whose effect sets state on GameShell and re-renders us — churning
  // identity here is an infinite loop, not just a wasted memo.
  const branch = useMemo(() => curLine.slice(1), [curLine])

  // Apply a validated move: seed the branch, or truncate-forward then append.
  function applyMove(fen: string, san: string) {
    if (line.length === 0) {
      setLine([{ fen: baseFen, san: '' }, { fen, san }])
      setIndex(1)
    } else {
      const kept = line.slice(0, index + 1)
      setLine([...kept, { fen, san }])
      setIndex(kept.length)
    }
    setPickupSquare(null)
  }

  // Returns the resulting node if `from→to` is legal from `effectiveFen`, else null.
  function tryMove(from: string, to: string, promotion = 'q'): ExploreNode | null {
    const game = new Chess(effectiveFen)
    try {
      const move = game.move({ from, to, promotion }) // board moves auto-queen
      return { fen: game.fen(), san: move.san }
    } catch {
      return null
    }
  }

  function canDragPiece({ piece }: PieceDragArgs): boolean {
    return piece.pieceType[0] === sideToMove(effectiveFen)
  }

  // Drag start: show hints for a side-to-move piece (ignore off-turn pickups).
  function onPieceDrag({ piece, square }: PieceDragArgs): void {
    if (piece.pieceType[0] === sideToMove(effectiveFen)) setPickupSquare(square)
  }

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropArgs): boolean {
    setPickupSquare(null) // clear the pickup on every drag end (legal / illegal / cancel)
    if (!targetSquare) return false
    const node = tryMove(sourceSquare, targetSquare)
    if (!node) return false
    applyMove(node.fen, node.san)
    return true
  }

  function onSquareClick({ piece, square }: SquareClickArgs): boolean {
    const ownPiece = piece != null && piece.pieceType[0] === sideToMove(effectiveFen)
    if (pickupSquare === null) {
      if (ownPiece) setPickupSquare(square)
      return false
    }
    if (square === pickupSquare) {
      setPickupSquare(null)
      return false
    }
    const node = tryMove(pickupSquare, square)
    if (node) {
      applyMove(node.fen, node.san)
      return true
    }
    setPickupSquare(ownPiece ? square : null) // reselect own piece, else drop
    return false
  }

  function playUci(uci: string): boolean {
    const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci)
    if (!match) return false
    const node = tryMove(match[1], match[2], match[3])
    if (!node) return false
    applyMove(node.fen, node.san)
    return true
  }

  function clearBranch(): void {
    setLine([])
    setIndex(0)
    setPickupSquare(null)
  }

  function back(): void {
    if (line.length <= 1) return
    if (index === 0) clearBranch()
    else setIndex(index - 1)
  }

  function forward(): void {
    setIndex((i) => Math.min(i + 1, line.length - 1))
  }

  function reset(): void {
    clearBranch()
  }

  function selectBranch(lineIndex: number): void {
    setIndex(Math.max(0, Math.min(lineIndex, line.length - 1)))
  }

  return {
    exploring,
    effectiveFen,
    branch,
    branchIndex: curIndex,
    canDragPiece,
    onPieceDrag,
    onPieceDrop,
    onSquareClick,
    playUci,
    squareStyles: buildLegalTargetStyles(effectiveFen, curPickup),
    back,
    forward,
    reset,
    selectBranch,
  }
}
