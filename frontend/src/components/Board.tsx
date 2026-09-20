import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow } from 'react-chessboard'
import MoveClassificationIcon from './MoveClassificationIcon'
import type { BoardBadge } from '../views/gameShellContext'
import styles from './Board.module.css'

// react-chessboard's handler arg shapes (a subset we use); kept local so callers
// don't import the library's types.
type PieceDropArgs = { sourceSquare: string; targetSquare: string | null }
type PieceDragArgs = { piece: { pieceType: string }; square: string | null }
type SquareClickArgs = { piece: { pieceType: string } | null; square: string }

interface Props {
  fen: string
  arrows?: Arrow[]
  badge?: BoardBadge
  flipped?: boolean
  // Interactivity (Analyze-route exploration). Off by default → read-only.
  interactive?: boolean
  onPieceDrop?: (args: PieceDropArgs) => boolean
  canDragPiece?: (args: PieceDragArgs) => boolean
  onSquareClick?: (args: SquareClickArgs) => void
  onPieceDrag?: (args: PieceDragArgs) => void
  squareStyles?: Record<string, CSSProperties> // legal-move hints (per-square overrides)
}

// Square → top-right corner percentage. Mirrors coords when board is flipped.
function badgeCorner(square: string, flipped: boolean): { left: number; top: number } {
  const file = square.charCodeAt(0) - 97  // a..h → 0..7
  const rank = Number(square[1])           // 1..8
  const col = flipped ? 7 - file : file
  const row = flipped ? rank - 1 : 8 - rank
  return { left: ((col + 1) / 8) * 100, top: (row / 8) * 100 }
}

export default function Board({
  fen, arrows = [], badge, flipped = false,
  interactive = false, onPieceDrop, canDragPiece, onSquareClick, onPieceDrag, squareStyles,
}: Props) {
  const badgePos = badge ? badgeCorner(badge.square, flipped) : null
  return (
    <div data-testid="board" data-fen={fen} className={styles.board}>
      <Chessboard
        options={{
          position: fen,
          boardOrientation: flipped ? 'black' : 'white',
          allowDragging: interactive,
          boardStyle: { width: '100%', height: '100%' },
          arrows,
          ...(interactive && { onPieceDrop, canDragPiece, onSquareClick }),
          ...(onPieceDrag && { onPieceDrag }),
          ...(squareStyles && { squareStyles }),
        }}
      />
      {arrows.length > 0 && (
        <div aria-hidden="true" className={styles.arrowMeta}>
          {arrows.map((a, i) => (
            <span key={i} data-arrow={`${a.startSquare}-${a.endSquare}`} />
          ))}
        </div>
      )}
      {badge && badgePos && (
        <div
          className={styles.badge}
          data-badge={'pending' in badge ? `${badge.square}-pending` : `${badge.square}-${badge.classification}`}
          style={{ left: `${badgePos.left}%`, top: `${badgePos.top}%` }}
        >
          {'pending' in badge ? (
            <span className={styles.badgePending} data-testid="board-badge-pending" aria-label="grading" />
          ) : (
            <MoveClassificationIcon classification={badge.classification} />
          )}
        </div>
      )}
    </div>
  )
}
