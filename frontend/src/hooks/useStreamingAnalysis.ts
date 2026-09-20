import { useEffect, useRef, useState } from 'react'
import type { AnalysisLine } from '../api/analyzer'
import { engine } from '../engine/stockfish'
import { putEval } from '../engine/evalCache'
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

const INITIAL: State =
  { lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: true, error: '' }
const IDLE: State =
  { lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: false, error: '' }

/** Display for a position the engine has not ticked for yet: carry the played
 *  line's tail (`predicted`), else hold the last live lines dimmed (`stale`).
 *  Neither synthesises `currentDepth` — the badge must not claim it. */
function displayFor(enabled: boolean, held: Held | null, fen: string): State {
  if (!enabled || !held) return enabled ? INITIAL : IDLE
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
  const [state, setState] = useState<State>(enabled ? INITIAL : IDLE)
  // The last *live* emission, kept as state (not a ref) because the render-time
  // reset below has to read it — this repo's react-hooks/refs rule forbids
  // touching a ref during render.
  const [held, setHeld] = useState<Held | null>(null)

  // Reset immediately so the live channel doesn't carry another position's
  // lines. Done during render (React's "adjust state while rendering" pattern)
  // keyed on the request inputs, rather than a synchronous setState in an effect.
  const key = `${fen}|${timeMs}|${lines}|${engineThreads}|${engineHash}|${enabled}`
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setState(displayFor(enabled, held, fen))
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

  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()

    const start = () => {
      lastStartRef.current = Date.now()
      engine
        .analyze(fen, { kind: 'movetime', ms: timeMs }, lines, (engineLines, depth, final) => {
          if (ctrl.signal.aborted) return
          // Feed the shared eval cache: the branch grader reuses this tip's eval
          // (fen == the branch's next before-position) to grade without a backend
          // search. Live frames only — a carried line is no search of this FEN.
          putEval(fen, engineLines, depth, lines)
          setHeld({ fen, lines: engineLines })
          setState({
            lines: engineLines,
            displayLines: engineLines,
            freshCount: engineLines.length,
            currentDepth: depth,
            loading: !final,
            error: '',
          })
        }, ctrl.signal)
        .catch((err: unknown) => {
          // analyze() resolves once dispatched, so a rejection here is a boot
          // failure (engine couldn't start / browser lacks SharedArrayBuffer).
          if (ctrl.signal.aborted) return
          const message = err instanceof Error ? err.message : 'Analysis failed'
          console.error('[streaming-analysis] engine failed', err)
          // The error wins over held lines: clear the display channel too.
          setState({ ...IDLE, error: message })
        })
    }

    // Leading-edge throttle: first change in a window fires with zero delay, a
    // burst (held arrow key) is bounded to one search per window. Replacing the
    // pending fire — not queueing behind it — is what searches where you land.
    const since = Date.now() - lastStartRef.current
    let timer: ReturnType<typeof setTimeout> | undefined
    if (since >= ANALYSIS_THROTTLE_MS) start()
    else timer = setTimeout(start, ANALYSIS_THROTTLE_MS - since)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      ctrl.abort()
    }
  }, [fen, timeMs, lines, engineThreads, engineHash, enabled])

  return state
}
