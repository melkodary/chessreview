import { useEffect, useState } from 'react'
import type { DependencyList } from 'react'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string
}

function depsChanged(a: DependencyList, b: DependencyList): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true
  return false
}

interface FetchOpts<T> {
  // When the resolved value is equal to the current data, keep the existing
  // reference instead of replacing it. Prevents a refetch that returns
  // structurally-identical data from churning the reference and forcing
  // consumers (and their children) to re-render for nothing.
  isEqual?: (prev: T, next: T) => boolean
}

export function useFetch<T>(
  fn: () => Promise<T>,
  deps: DependencyList,
  opts: FetchOpts<T> = {},
): FetchState<T> {
  const { isEqual } = opts
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Reset to the loading state when the request inputs change — done during
  // render (React's "adjust state while rendering" pattern) rather than in the
  // effect, so there's no synchronous setState cascade inside the effect.
  const [prevDeps, setPrevDeps] = useState<DependencyList>(deps)
  if (depsChanged(prevDeps, deps)) {
    setPrevDeps(deps)
    setLoading(true)
    setError('')
  }

  useEffect(() => {
    let cancelled = false
    fn()
      .then((d) => {
        if (cancelled) return
        setData((prev) => (prev !== null && isEqual?.(prev, d) ? prev : d))
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Unknown error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}
