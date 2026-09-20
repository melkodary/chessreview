import { useEffect, useLayoutEffect, useRef } from 'react'

interface Handlers {
  left?: () => void
  right?: () => void
  up?: () => void
  down?: () => void
}

export function useKeyboardNav(handlers: Handlers): void {
  const ref = useRef(handlers)
  // Keep the ref pointed at the latest handlers without re-binding the listener.
  // Written in an effect (not during render) so render stays side-effect-free,
  // and a *layout* one because a passive effect flushes on a later task than the
  // commit: a keypress landing in that window ran a stale handler and navigated
  // to the tab the user just left.
  useLayoutEffect(() => { ref.current = handlers })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const h = ref.current
      if (e.key === 'ArrowLeft') h.left?.()
      else if (e.key === 'ArrowRight') h.right?.()
      else if (e.key === 'ArrowUp') h.up?.()
      else if (e.key === 'ArrowDown') h.down?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
