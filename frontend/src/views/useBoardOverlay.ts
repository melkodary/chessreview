import { useEffect } from 'react'
import { useGameShell } from './gameShellContext'
import type { BoardOverlay } from './gameShellContext'

export function useBoardOverlay(overlay: BoardOverlay) {
  const { setBoardOverlay } = useGameShell()
  useEffect(() => { setBoardOverlay(overlay) }, [setBoardOverlay, overlay])
}
