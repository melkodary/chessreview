import { useEffect, type RefObject } from 'react'

/**
 * Closes a header popover on an outside mousedown or Escape, while it is open.
 * Shared by the gear and the stats menu so the two dismiss identically.
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: (open: false) => void,
) {
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss(false)
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, ref, onDismiss])
}
