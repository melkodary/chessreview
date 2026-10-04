import { useEffect, useRef, useState } from 'react'
import type { AnalysisLine } from '../api/analyzer'
import { engine, type OnLines } from '../engine/stockfish'
import { getEval, putEval } from '../engine/evalCache'
import { carryLines } from '../engine/pvCarry'
import { ANALYSIS_THROTTLE_MS } from '../config'

interface State {
  lines: AnalysisLine[]         // live only; [] until the first tick for this FEN
  displayLines: AnalysisLine[]  // live, carried, or held
  freshCount: number            // displayLines[0..freshCount) are trustworthy
  currentDepth: number
  loading: boolean
  error: string
}

interface Held {
  fen: string
  lines: AnalysisLine[]
}

// The one Analysis search, kept past its panel's unmount (a tab flip): it runs its
// budget into the cache, and a remount on the same request re-attaches to it. A new
// request replaces it; requests already searched to their full budget never re-run.
interface Live { key: string; ctrl: AbortController; frame?: Parameters<OnLines>; listener: OnLines | null }
let live: Live | null = null
const SETTLED_MAX = 512
const settled = new Set<string>()

/** Test seam: forget the running search and every settled request. */
export function resetStreamingAnalysis(): void {
  live = null
  settled.clear()
}

const INITIAL: State =
  { lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: true, error: '' }
const IDLE: State =
  { lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: false, error: '' }

/** Display for a position the engine has not ticked for yet: an earlier search
 *  of this FEN from the eval cache (depth included — it was really searched),
 *  else carry the played line's tail, else hold the last live lines dimmed. */
function displayFor(enabled: boolean, held: Held | null, fen: string, multipv: number, request: string): State {
  if (!enabled) return IDLE
  const cached = getEval(fen, multipv)
  if (cached) {
    const lines = cached.lines.slice(0, multipv)
    const done = settled.has(request) && live?.key !== request
    return { ...INITIAL, displayLines: lines, freshCount: lines.length, currentDepth: cached.depth, loading: !done }
  }
  if (!held) return INITIAL
  // Same FEN, new search (a time/multipv/engine setting changed): the held lines
  // genuinely belong to the position on screen, so nothing is stale.
  if (held.fen === fen) {
    return { ...INITIAL, displayLines: held.lines, freshCount: held.lines.length }
  }
  const carried = carryLines(held.fen, held.lines, fen)
  return carried
    ? { ...INITIAL, displayLines: carried.lines, freshCount: 1 }
    : { ...INITIAL, displayLines: held.lines, freshCount: 0 }
}

export function useStreamingAnalysis(
  fen: string,
  timeMs: number,
  lines: number,
  engineThreads: number,
  engineHash: number,
  enabled = true,
): State {
  const request = `${fen}|${timeMs}|${lines}|${engineThreads}|${engineHash}`
  const [state, setState] = useState<State>(() => displayFor(enabled, null, fen, lines, request))
  // The last *live* emission, kept as state (not a ref) because the render-time
  // reset below has to read it — this repo's react-hooks/refs rule forbids
  // touching a ref during render.
  const [held, setHeld] = useState<Held | null>(null)

  // Reset immediately so the live channel doesn't carry another position's
  // lines. Done during render (React's "adjust state while rendering" pattern)
  // keyed on the request inputs, rather than a synchronous setState in an effect.
  const key = `${request}|${enabled}`
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setState(displayFor(enabled, held, fen, lines, request))
    // Returning to the game start — and, in practice, arriving at a different
    // game — must not surface another position's lines.
    if (!enabled && held) setHeld(null)
  }

  // Declared before the analyze effect so its teardown (on threads/hash change)
  // runs before the re-triggered analyze reboots, in the same commit. Keyed
  // only on threads/hash — not fen/time/lines — so normal navigation doesn't
  // tear down the worker and lose hash reuse.
  useEffect(() => {
    engine.configure({ threads: engineThreads, hash: engineHash })
  }, [engineThreads, engineHash])

  // Touched only inside the effect body and the timeout callback — never during
  // render — to stay clear of the react-hooks/refs rule.
  const lastStartRef = useRef(Number.NEGATIVE_INFINITY)
  // This panel's last search: a request change while mounted stops it at once, as
  // before; only an unmount (the tab flip) leaves it running.
  const ownRef = useRef<Live | null>(null)

  useEffect(() => {
    const prev = ownRef.current
    if (prev && live === prev && (prev.key !== request || !enabled)) {
      prev.ctrl.abort()
      live = null
    }
    if (!enabled) return
    // A re-search (revisit) climbs back through depths the cache already holds;
    // hide those so the display never regresses.
    const floor = getEval(fen, lines)?.depth ?? 0
    const onFrame: OnLines = (engineLines, depth, final) => {
      if (depth < floor) {
        if (final) setState((s) => ({ ...s, loading: false }))
        return
      }
      setHeld({ fen, lines: engineLines })
      setState({
        lines: engineLines,
        displayLines: engineLines,
        freshCount: engineLines.length,
        currentDepth: depth,
        loading: !final,
        error: '',
      })
    }
    let mine: Live | null = null

    const start = () => {
      lastStartRef.current = Date.now()
      const search: Live = { key: request, ctrl: new AbortController(), listener: onFrame }
      live = mine = ownRef.current = search
      engine
        .analyze(fen, { kind: 'movetime', ms: timeMs }, lines, (engineLines, depth, final) => {
          if (live !== search) return
          // Feed the shared eval cache, attached or not: the branch grader reuses
          // this eval, and a remount reads it. A carried line is no search of this FEN.
          putEval(fen, engineLines, depth, lines)
          search.frame = [engineLines, depth, final]
          if (final) {
            settled.add(request)
            if (settled.size > SETTLED_MAX) settled.delete(settled.values().next().value!)
            live = null
          }
          search.listener?.(engineLines, depth, final)
        }, search.ctrl.signal)
        .catch((err: unknown) => {
          // analyze() resolves once dispatched, so a rejection here is a boot
          // failure (engine couldn't start / browser lacks SharedArrayBuffer).
          if (live !== search || !search.listener) return
          const message = err instanceof Error ? err.message : 'Analysis failed'
          console.error('[streaming-analysis] engine failed', err)
          // The error wins over held lines: clear the display channel too.
          setState({ ...IDLE, error: message })
        })
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    if (live?.key === request) {
      mine = ownRef.current = live // the search this panel left is still running: re-attach
      live.listener = onFrame
      if (live.frame) onFrame(...live.frame)
    } else if (!settled.has(request)) {
      // Leading-edge throttle: first change in a window fires with zero delay, a
      // burst (held arrow key) is bounded to one search per window. Replacing the
      // pending fire — not queueing behind it — is what searches where you land.
      const since = Date.now() - lastStartRef.current
      if (since >= ANALYSIS_THROTTLE_MS) start()
      else timer = setTimeout(start, ANALYSIS_THROTTLE_MS - since)
    }

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      if (mine) mine.listener = null // detach only: the search keeps its budget
    }
  }, [fen, timeMs, lines, engineThreads, engineHash, enabled, request])

  return state
}
