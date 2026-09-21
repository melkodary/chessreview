import type { JSX } from 'react'
import { postJson } from './request'
import type {
  ExplainArm,
  ExplainCheckNode,
  ExplainFamily,
  ExplainTrace,
} from './types'

export type Classification =
  | 'book' | 'forced'
  | 'brilliant' | 'great' | 'best' | 'excellent' | 'good'
  | 'inaccuracy' | 'mistake' | 'blunder' | 'miss'

// `@private`'s override of core's neutral labels/glyphs/palette — partial,
// keyed by the same Classification ids. Stub exports `{}`.
export interface ClassificationSkin {
  labels?: Partial<Record<Classification, string>>
  shapes?: Partial<Record<Classification, JSX.Element>>
  palette?: Partial<Record<Classification, string>>
}

export interface MoveReview {
  ply: number
  san: string
  fenBefore: string
  evalBefore: number
  evalAfterPlayed: number
  bestMoveSan: string
  winBefore: number
  winAfterPlayed: number
  winAfterSecond?: number | null
  winDrop: number
  classification: Classification
  mateBefore: number | null
  mateAfterPlayed: number | null
}

export interface SideSummary {
  accuracy: number | null
  gameRating?: number
  counts: Partial<Record<Classification, number>>
  biggestBlunderPly: number | null
}

interface OpeningInfo {
  eco: string
  name: string
  untilPly: number
}

export interface ReviewSummary {
  white: SideSummary
  black: SideSummary
  gameRatingAlgorithm?: string
  keyMoments: number[]
  opening: OpeningInfo | null
}

interface ExplainLine {
  uci: string
  cp?: number
  mate?: number
}

interface ExplainEval {
  cp?: number
  mate?: number
}

interface ExplainRequestBase {
  whiteElo?: number
  blackElo?: number
  prevBeforeEval?: number
  // The opponent's last move, which great's non-obviousness gate reads. Both
  // or neither; without them that check renders as unknown.
  prevFen?: string
  prevUci?: string
  depth?: number
  multipv?: number
}

export type ExplainMoveRequest =
  | (ExplainRequestBase & { move: MoveReview })
  | (ExplainRequestBase & {
      fenBefore: string
      uci: string
      beforeLines?: ExplainLine[]
      afterEval?: ExplainEval
    })

interface BackendCheck {
  kind: 'check' | 'group'
  name: string
  mode?: 'any'
  lhs?: number | boolean | null
  op?: string
  rhs?: number | boolean
  state: 'ok' | 'fail' | 'unknown'
  margin?: number | null
  checks?: BackendCheck[]
}

interface BackendTrace {
  label: string
  header: {
    san: string
    color: 'white' | 'black'
    elo: number
    k: number
    source: string
    stored_label: string | null
    cp: Record<string, number | null>
  }
  families: Array<{
    name: string
    state: 'yes' | 'no' | 'indeterminate'
    arms: Array<{
      name: string
      state: 'yes' | 'no' | 'indeterminate'
      blocked_by: string | null
      checks: BackendCheck[]
    }>
  }>
  k_panel: {
    at_1000: number
    at_2000: number
    clamp: [number, number]
    active: number
    clamped: boolean
    rows: Array<{
      feature: string
      cp: number | null
      at_1000: number | null
      at_k: number | null
      at_2000: number | null
    }>
  }
  band_for: { label: string; drop: number }
  partial: string[]
}

const snakeMove = (move: MoveReview) => ({
  ply: move.ply,
  san: move.san,
  fen_before: move.fenBefore,
  eval_before: move.evalBefore,
  eval_after_played: move.evalAfterPlayed,
  best_move_san: move.bestMoveSan,
  win_before: move.winBefore,
  win_after_played: move.winAfterPlayed,
  ...(move.winAfterSecond === undefined
    ? {}
    : { win_after_second: move.winAfterSecond }),
  win_drop: move.winDrop,
  classification: move.classification,
  mate_before: move.mateBefore,
  mate_after_played: move.mateAfterPlayed,
})

function camelCheck(check: BackendCheck): ExplainCheckNode {
  if (check.kind === 'group') {
    return {
      kind: 'group',
      name: check.name,
      mode: check.mode ?? 'any',
      state: check.state,
      checks: (check.checks ?? []).map(camelCheck),
    }
  }
  return {
    kind: 'check',
    name: check.name,
    lhs: check.lhs ?? null,
    op: check.op ?? '',
    rhs: check.rhs ?? false,
    state: check.state,
    margin: check.margin ?? null,
  }
}

function camelTrace(trace: BackendTrace): ExplainTrace {
  const families: ExplainFamily[] = trace.families.map((family) => ({
    name: family.name,
    state: family.state,
    arms: family.arms.map((arm): ExplainArm => ({
      name: arm.name,
      state: arm.state,
      blockedBy: arm.blocked_by,
      checks: arm.checks.map(camelCheck),
    })),
  }))
  return {
    label: trace.label,
    header: {
      san: trace.header.san,
      color: trace.header.color,
      elo: trace.header.elo,
      k: trace.header.k,
      source: trace.header.source,
      storedLabel: trace.header.stored_label,
      cp: trace.header.cp,
    },
    families,
    kPanel: {
      at1000: trace.k_panel.at_1000,
      at2000: trace.k_panel.at_2000,
      clamp: trace.k_panel.clamp,
      active: trace.k_panel.active,
      clamped: trace.k_panel.clamped,
      rows: trace.k_panel.rows.map((row) => ({
        feature: row.feature,
        cp: row.cp,
        at1000: row.at_1000,
        atK: row.at_k,
        at2000: row.at_2000,
      })),
    },
    bandFor: trace.band_for,
    partial: trace.partial,
  }
}

// One browser-estimated curve point. Deliberately has no `classification`: the
// type is structurally incapable of producing a badge, entering MoveList, or
// reaching partialSummary, which is what keeps WASM evals out of the surfaces
// the 2026-07-16 gate closed.
export interface ProvisionalPoint {
  ply: number
  winAfterPlayed: number
}

// White-POV cp or mate for one swept ply — exactly one, matching the backend's
// `_CpOrMate` convention (engine/sweepGame.ts produces this shape).
export interface WinChanceInput {
  ply: number
  cpWhite?: number
  mate?: number
}

// cp → mover-POV win-%, converted by the backend because `review/expected.py`'s
// sigmoid constants are env-tunable: a mirrored copy in config.ts would drift
// silently the first time one is retuned, and the curve would be wrong with
// nothing on screen to reveal it.
export async function winChance(
  points: WinChanceInput[],
  whiteElo: number | undefined,
  blackElo: number | undefined,
  signal?: AbortSignal,
): Promise<ProvisionalPoint[]> {
  const rows = await postJson<Array<{ ply: number; win_after_played: number }>>(
    '/win-chance',
    {
      white_elo: whiteElo,
      black_elo: blackElo,
      points: points.map((p) => ({
        ply: p.ply,
        ...(p.mate != null ? { mate: p.mate } : { cp_white: p.cpWhite }),
      })),
    },
    () => new Error('Could not convert provisional evals'),
    signal,
  )
  return rows.map((row) => ({ ply: row.ply, winAfterPlayed: row.win_after_played }))
}

export class ExplainDisabledError extends Error {
  constructor() {
    super('Explain is disabled on this instance')
    this.name = 'ExplainDisabledError'
  }
}

export async function explainMove(request: ExplainMoveRequest): Promise<ExplainTrace> {
  const common = {
    white_elo: request.whiteElo,
    black_elo: request.blackElo,
    prev_before_eval: request.prevBeforeEval,
    prev_fen: request.prevFen,
    prev_uci: request.prevUci,
  }
  const body = 'move' in request
    ? { move: snakeMove(request.move), ...common }
    : {
        fen_before: request.fenBefore,
        uci: request.uci,
        depth: request.depth,
        multipv: request.multipv,
        before_lines: request.beforeLines,
        after_eval: request.afterEval,
        ...common,
      }
  const trace = await postJson<BackendTrace>(
    '/reviews/explain',
    body,
    (response) => response.status === 404
      ? new ExplainDisabledError()
      : new Error('Could not explain move'),
  )
  return camelTrace(trace)
}
