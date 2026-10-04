// An env var that is *set but empty* means absent. A build can pass a var
// through unconditionally — CI expands an unset repo Variable to '' — and Vite
// bakes that empty string into the bundle. Without this, `??` keeps the '' and
// `Number('')` is a finite 0, so the fallbacks below silently never fire.
const env = (v: string | undefined): string | undefined => (v === '' ? undefined : v)

const num = (raw: string | undefined, fallback: number): number => {
  const v = env(raw)
  const n = Number(v)
  return v != null && Number.isFinite(n) ? n : fallback
}

const bool = (raw: string | undefined, fallback: boolean): boolean => {
  const v = env(raw)
  return v == null ? fallback : v === 'true' || v === '1'
}

export const API_BASE               = env(import.meta.env.VITE_API_BASE)          ?? 'http://localhost:8000'
export const LICHESS_API_BASE       = env(import.meta.env.VITE_LICHESS_API_BASE)  ?? 'https://lichess.org'
export const GAMES_PAGE_SIZE        = num(import.meta.env.VITE_GAMES_PAGE_SIZE, 10)
export const DEFAULT_REVIEW_DEPTH   = num(import.meta.env.VITE_DEFAULT_REVIEW_DEPTH, 18)
export const DEFAULT_REVIEW_MULTIPV = num(import.meta.env.VITE_DEFAULT_REVIEW_MULTIPV, 2)
export const DEFAULT_ANALYSIS_LINES = num(import.meta.env.VITE_DEFAULT_ANALYSIS_LINES, 3)
export const REVIEW_ACTIVE_POLL_MS  = num(import.meta.env.VITE_REVIEW_ACTIVE_POLL_MS, 2000)
export const EXPORT_FEEDBACK_MS     = num(import.meta.env.VITE_EXPORT_FEEDBACK_MS, 1500)
export const ENABLE_EXPLAIN         = bool(import.meta.env.VITE_ENABLE_EXPLAIN, true)
// Below this many labelled plies a benchmark row is muted as a thin sample.
export const STATS_THIN_N           = num(import.meta.env.VITE_STATS_THIN_N, 30)

// Client-WASM Stockfish (analyze tab). Threads/Hash defaults; user-adjustable
// via Settings, bounded by device cores (Threads) and ENGINE_HASH_STEPS (Hash).
export const ENGINE_THREADS_CAP     = num(import.meta.env.VITE_ENGINE_THREADS_CAP, 8)
export const ENGINE_HASH_MB         = num(import.meta.env.VITE_ENGINE_HASH_MB, 64)
export const ENGINE_HASH_STEPS      = [16, 32, 64, 128, 256, 512]
export const ENGINE_PV_DEPTH        = num(import.meta.env.VITE_ENGINE_PV_DEPTH, 12)
export const ENGINE_BOOT_TIMEOUT_MS = num(import.meta.env.VITE_ENGINE_BOOT_TIMEOUT_MS, 10_000)
// A depth-limited WASM search that has not reached its depth by now is given up
// (→ backend fallback): the 19 lite build can stall short of depth with a warm hash.
export const ENGINE_DEPTH_TIMEOUT_MS = num(import.meta.env.VITE_ENGINE_DEPTH_TIMEOUT_MS, 30_000)
// How long a stopped search may take to answer with its `bestmove` before the
// worker is replaced: the engine has ignored `stop` for 80s+ once.
export const ENGINE_STOP_GRACE_MS = num(import.meta.env.VITE_ENGINE_STOP_GRACE_MS, 3_000)
// Threads per grade-pool worker (grading, sweeps). Fewer WASM threads reach a fixed depth
// sooner: 1 thread median 1.1s / max 4.0s, 8 threads 2.6s / 30s+ (spec 2026-10-04).
export const GRADE_ENGINE_THREADS = num(import.meta.env.VITE_GRADE_ENGINE_THREADS, 1)
// Grade workers: min(cores − 1, this). Four 1-thread engines at once: each search
// ~30% slower than alone (p90 2.9s); 3 × 2-thread did worse (p90 5.6s).
export const GRADE_WORKERS_MAX = num(import.meta.env.VITE_GRADE_WORKERS_MAX, 4)
export const GRADE_ENGINE_HASH_MB = num(import.meta.env.VITE_GRADE_ENGINE_HASH_MB, 32)

// Analysis searches on a wall-clock budget, not a depth target — depth is an
// output (the badge), never an input. Steps in seconds; the setting persists ms.
export const ANALYSIS_TIME_STEPS       = [5, 10, 20, 60]
export const DEFAULT_ANALYSIS_TIME_MS  = num(import.meta.env.VITE_DEFAULT_ANALYSIS_TIME_MS, 20_000)
// Safety valve on the movetime search, not a setting: a solved position (short
// forced mate) would otherwise spin out the rest of the budget re-confirming
// itself. High enough to be unreachable inside any offered budget, so it never
// silently shortens the wait the user asked for.
export const ANALYSIS_DEPTH_CEILING    = num(import.meta.env.VITE_ANALYSIS_DEPTH_CEILING, 60)
// Leading-edge throttle on the analysis search: the first position change in a
// window fires immediately, a burst (held arrow key) is bounded to one search per
// window with a guaranteed trailing fire. 0 disables it — every change fires.
export const ANALYSIS_THROTTLE_MS      = num(import.meta.env.VITE_ANALYSIS_THROTTLE_MS, 250)

// Grade a deviation branch ply from the browser's own eval-bar / grader WASM
// search (attaching evals to POST /reviews/move so the backend skips Stockfish)
// rather than always making the backend search. On → attach evals when a
// position is cached/searchable at review depth; off → always omit → backend
// searches (guaranteed parity). Doubles as a live parity switch. No Settings UI
// this phase — a plain env default (see the phase-2 deviation-grading spec).
export const GRADE_WITH_FRONTEND_ENGINE = bool(import.meta.env.VITE_GRADE_WITH_FRONTEND_ENGINE, true)
// Pre-search where the user is parked on Review: the position and its top moves'
// after-positions. Off until the grade trace's hit rate says it pays (spec 2026-10-04 §5).
export const SPECULATE = bool(import.meta.env.VITE_SPECULATE, false)
export const SPECULATE_DELAY_MS = num(import.meta.env.VITE_SPECULATE_DELAY_MS, 600)
export const SPECULATE_MOVES = num(import.meta.env.VITE_SPECULATE_MOVES, 2)

// Provisional in-browser eval curve (engine/sweepGame.ts): shallow, rank-1-only
// so a laptop sweep lands inside the review wait (lab 101 — MultiPV 1 is 3.3x
// cheaper than lab 100's MultiPV 3 for +0.47 win-points of median error and no
// extra visible sign flips). See the phase-2 provisional-eval-curve spec.
export const SWEEP_DEPTH     = num(import.meta.env.VITE_SWEEP_DEPTH, 12)
export const SWEEP_MULTIPV   = num(import.meta.env.VITE_SWEEP_MULTIPV, 1)
export const SWEEP_FLUSH_MS  = num(import.meta.env.VITE_SWEEP_FLUSH_MS, 1000)
// Factory default for the user-facing kill switch, not the switch itself:
// SETTINGS_STORAGE.provisionalCurve falls back to this until the user picks.
export const PROVISIONAL_CURVE_DEFAULT = bool(import.meta.env.VITE_PROVISIONAL_CURVE_DEFAULT, true)
