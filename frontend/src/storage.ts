import type { Game } from './api/types'
import { ANALYSIS_TIME_STEPS, DEFAULT_ANALYSIS_LINES, DEFAULT_ANALYSIS_TIME_MS, DEFAULT_REVIEW_DEPTH, DEFAULT_REVIEW_MULTIPV, ENGINE_HASH_STEPS, ENGINE_HASH_MB, ENGINE_THREADS_CAP, PROVISIONAL_CURVE_DEFAULT } from './config'

export type Theme = 'light' | 'dark'

export const STORAGE_KEYS = {
  theme: 'chessreview-theme',
  // The old `chessreview-depth` key is deliberately not migrated: a depth target
  // and a time budget have unrelated value semantics, so there is no honest
  // conversion. Returning users land on the default.
  analysisTimeMs: 'chessreview-analysis-time-ms',
  analysisLines: 'chessreview-analysis-lines',
  reviewDepth: 'chessreview-review-depth',
  reviewMultiPv: 'chessreview-review-multipv',
  engineThreads: 'chessreview-engine-threads',
  engineHash: 'chessreview-engine-hash',
  provisionalCurve: 'chessreview-provisional-curve',
  settingsTab: 'chessreview-settings-tab',
  // Games imported as PGN (api/sources/pgn.ts) — the only source with no server.
  pgnGames: 'chessreview-pgn-games',
} as const

export type SettingsTab = 'analysis' | 'review'

export const ENGINE_URL = '/engine/stockfish-19-lite.js'
// What the backend's Stockfish reports as UCI `id name`; the browser build runs the
// lite net and stamps its own label so a stored review says which net produced it.
export const REVIEW_ENGINE_NAME = 'Stockfish 19'
export const WASM_ENGINE_NAME = 'Stockfish 19 Lite'
export const ENGINE_MB = 2

function defaultEngineThreads(): number {
  return Math.max(1, Math.min(navigator.hardwareConcurrency ?? 2, ENGINE_THREADS_CAP))
}

export const DEFAULTS = {
  theme: 'dark' as Theme,
  analysisTimeMs: DEFAULT_ANALYSIS_TIME_MS,
  analysisLines: DEFAULT_ANALYSIS_LINES,
  reviewDepth: DEFAULT_REVIEW_DEPTH,
  reviewMultiPv: DEFAULT_REVIEW_MULTIPV,
  get engineThreads() {
    return defaultEngineThreads()
  },
  engineHash: ENGINE_HASH_MB,
  provisionalCurve: PROVISIONAL_CURVE_DEFAULT,
  settingsTab: 'analysis' as SettingsTab,
}

export interface StoredSetting<T> {
  load: () => T
  save: (value: T) => void
}

function storedSetting<T>(
  key: string,
  fallback: () => T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string = String,
): StoredSetting<T> {
  // A blocked store (private window, cleared site data) or a corrupt value
  // reads as the fallback and writes as a no-op — never a crash.
  return {
    load: () => {
      try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback() : (parse(raw) ?? fallback())
      } catch {
        return fallback()
      }
    },
    save: (value) => {
      try {
        localStorage.setItem(key, serialize(value))
      } catch {
        // quota or blocked storage
      }
    },
  }
}

// Games imported as PGN (api/sources/pgn.ts): the whole list, newest first.
export const PGN_GAMES_STORAGE = storedSetting<Game[]>(
  STORAGE_KEYS.pgnGames,
  () => [],
  (raw) => { const v = JSON.parse(raw); return Array.isArray(v) ? (v as Game[]) : undefined },
  JSON.stringify,
)

const numberInRange = (min: number, max: number) => (raw: string) => {
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : undefined
}

export const SETTINGS_STORAGE = {
  theme: storedSetting<Theme>(
    STORAGE_KEYS.theme,
    () => DEFAULTS.theme,
    (raw) => raw === 'dark' || raw === 'light' ? raw : undefined,
  ),
  analysisTimeMs: storedSetting(
    STORAGE_KEYS.analysisTimeMs,
    () => DEFAULTS.analysisTimeMs,
    (raw) => {
      const value = Number(raw)
      return ANALYSIS_TIME_STEPS.some((step) => step * 1000 === value) ? value : undefined
    },
  ),
  // Min 2: branch grading needs a second-best line from this same setting.
  analysisLines: storedSetting(
    STORAGE_KEYS.analysisLines,
    () => DEFAULTS.analysisLines,
    numberInRange(2, 5),
  ),
  reviewDepth: storedSetting(
    STORAGE_KEYS.reviewDepth,
    () => DEFAULTS.reviewDepth,
    numberInRange(14, 24),
  ),
  reviewMultiPv: storedSetting(
    STORAGE_KEYS.reviewMultiPv,
    () => DEFAULTS.reviewMultiPv,
    numberInRange(2, 4),
  ),
  engineThreads: storedSetting(
    STORAGE_KEYS.engineThreads,
    () => DEFAULTS.engineThreads,
    (raw) => {
      const value = Number(raw)
      const max = Math.max(1, navigator.hardwareConcurrency ?? 2)
      return Number.isFinite(value) && value >= 1 ? Math.min(value, max) : undefined
    },
  ),
  engineHash: storedSetting(
    STORAGE_KEYS.engineHash,
    () => DEFAULTS.engineHash,
    (raw) => {
      const value = Number(raw)
      if (!Number.isFinite(value)) return undefined
      return ENGINE_HASH_STEPS.reduce((closest, step) =>
        Math.abs(step - value) < Math.abs(closest - value) ? step : closest)
    },
  ),
  // Kill switch for the browser-swept provisional eval curve. Off means the
  // sweep never boots the engine at all, not merely that the curve is hidden.
  provisionalCurve: storedSetting<boolean>(
    STORAGE_KEYS.provisionalCurve,
    () => DEFAULTS.provisionalCurve,
    (raw) => raw === 'true' ? true : raw === 'false' ? false : undefined,
  ),
  settingsTab: storedSetting<SettingsTab>(
    STORAGE_KEYS.settingsTab,
    () => DEFAULTS.settingsTab,
    (raw) => raw === 'analysis' || raw === 'review' ? raw : undefined,
  ),
}
