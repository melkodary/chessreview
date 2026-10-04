import type { EvalOutcome } from './ensureEval'

// One grading attempt at one branch ply: where its time went and why it ended.
// A ply re-graded after an abort gets one entry per attempt (`pass` counts them).
export interface GradeTrace {
  ply: number
  san: string
  outcome: 'done' | 'error' | 'aborted'
  classification?: string
  // From the move first appearing in the branch: the wait the user saw.
  sinceMoveMs: number
  passMs: number
  pass: number
  // What changed since the previous attempt was scheduled (empty on the first).
  causes: string[]
  before?: EvalOutcome
  after?: EvalOutcome | 'terminal'
  backend?: { ms: number; failed?: boolean } // the classify round-trip
}

const MAX_ENTRIES = 200
const entries: GradeTrace[] = []
export const gradeTrace: readonly GradeTrace[] = entries
const firstSeen = new Map<string, { at: number; passes: number }>()

// Read from devtools: `gradeTrace` (latest last), `copy(gradeTrace)` to share.
;(globalThis as { gradeTrace?: GradeTrace[] }).gradeTrace = entries

/** Stamp when a branch node (by FEN) first needed a grade; idempotent. */
export function noteNeeded(fen: string): void {
  if (!firstSeen.has(fen)) firstSeen.set(fen, { at: performance.now(), passes: 0 })
  if (firstSeen.size > MAX_ENTRIES) firstSeen.delete(firstSeen.keys().next().value!)
}

/** Start an attempt at `fen`; returns its pass number and the ms since first needed. */
export function beginAttempt(fen: string): { pass: number; sinceMove: () => number } {
  noteNeeded(fen)
  const seen = firstSeen.get(fen)!
  seen.passes++
  return { pass: seen.passes, sinceMove: () => performance.now() - seen.at }
}

export function recordGrade(fen: string, t: GradeTrace): void {
  entries.push(t)
  if (entries.length > MAX_ENTRIES) entries.shift()
  if (t.outcome !== 'aborted') firstSeen.delete(fen)
  console.debug(formatGrade(t))
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`

function formatEval(label: string, o: EvalOutcome | 'terminal' | undefined): string | null {
  if (!o) return null
  if (o === 'terminal') return `${label} terminal`
  const spec = o.speculated ? ' speculated' : ''
  if (o.source === 'cache') return `${label} cache d${o.depth}${spec}`
  const first = o.firstFrameMs != null ? `, first frame ${s(o.firstFrameMs)}` : ''
  return `${label} search ${s(o.ms)} → d${o.depth} ${o.result}${spec} (engine ${o.engineState}${first})`
}

export function formatGrade(t: GradeTrace): string {
  const head = `[grade] ply ${t.ply + 1} ${t.san} ${t.outcome}${t.classification ? ` "${t.classification}"` : ''}`
    + ` · ${s(t.sinceMoveMs)} since move · pass ${t.pass} ${s(t.passMs)}`
    + (t.causes.length ? ` (restarted by ${t.causes.join(', ')})` : '')
  const parts = [
    formatEval('before', t.before),
    formatEval('after', t.after),
    t.backend && `backend ${s(t.backend.ms)}${t.backend.failed ? ' FAILED' : ''}`,
  ].filter(Boolean)
  return [head, ...parts].join(' · ')
}
