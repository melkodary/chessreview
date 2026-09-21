// Provider-neutral game model. Each source adapter maps its raw payload to this.

// A registry key in api/sources (`lichess`, `pgn`, plus whatever `@private`
// adds). A string, not a union: the public and lab builds have different sets.
export type Source = string

export interface Player {
  username: string
  rating?: number
  result: 'win' | 'loss' | 'draw'
}

export interface Game {
  source: Source
  id: string // provider game id
  white: Player
  black: Player
  pgn: string
  endTime: number // unix seconds
  url: string
}

// One provider. listRecent returns at most `limit` most-recent games; fetchGame
// resolves a single game by its provider id (null if not found). `label` is the
// user-facing name (source toggle, header badge).
export interface GameSource {
  label: string
  listRecent(username: string, limit: number, until?: number): Promise<Game[]>
  fetchGame(username: string, id: string): Promise<Game | null>
}

// The precomputed classifier-vs-reference-labels benchmark (GET /stats/classifier).
// Served verbatim from a committed artifact — the field names are the
// generator's, so no camel-casing layer sits between the two.
export interface StatsLabel {
  label: string
  n: number
  precision: number
  recall: number
}

export interface StatsBand {
  key: string
  label: string
  agreement: { exact: number; within_one: number }
  labels: StatsLabel[]
}

export interface ClassifierStats {
  generated_at: string
  corpus: { games: number; elo_min: number; elo_max: number }
  bands: StatsBand[]
}

export type ExplainCheckState = 'ok' | 'fail' | 'unknown'
export type ExplainRuleState = 'yes' | 'no' | 'indeterminate'

export interface ExplainCheck {
  kind: 'check'
  name: string
  lhs: number | boolean | null
  op: string
  rhs: number | boolean
  state: ExplainCheckState
  margin: number | null
}

export interface ExplainGroup {
  kind: 'group'
  name: string
  mode: 'any'
  state: ExplainCheckState
  checks: ExplainCheckNode[]
}

export type ExplainCheckNode = ExplainCheck | ExplainGroup

export interface ExplainArm {
  name: string
  state: ExplainRuleState
  blockedBy: string | null
  checks: ExplainCheckNode[]
}

export interface ExplainFamily {
  name: string
  state: ExplainRuleState
  arms: ExplainArm[]
}

export interface ExplainKRow {
  feature: string
  cp: number | null
  at1000: number | null
  atK: number | null
  at2000: number | null
}

export interface ExplainTrace {
  label: string
  header: {
    san: string
    color: 'white' | 'black'
    elo: number
    k: number
    source: string
    storedLabel: string | null
    cp: Record<string, number | null>
  }
  families: ExplainFamily[]
  kPanel: {
    at1000: number
    at2000: number
    clamp: [number, number]
    active: number
    clamped: boolean
    rows: ExplainKRow[]
  }
  bandFor: { label: string; drop: number }
  partial: string[]
}
