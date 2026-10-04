import type { Classification, MoveReview, ReviewSummary } from './review'
import type { ReviewPly } from '../engine/reviewPayload'
import { postJson } from './request'
import { API_BASE as BASE } from '../config'
import { routes } from '../router'

export interface AnalysisLine {
  moves: string[]
  evaluation: number
  mate: number | null
  // Principal variation as raw UCI moves (pre-SAN). pvUci[0] identifies the
  // line's move when a cached eval feeds deviation grading.
  pvUci?: string[]
}

interface BackendMove {
  ply: number; san: string; fen_before: string
  eval_before: number; eval_after_played: number
  best_move_san: string
  win_before: number; win_after_played: number; win_after_second?: number | null; win_drop: number
  classification: string
  mate_before: number | null; mate_after_played: number | null
}

interface BackendSideSummary {
  accuracy: number; game_rating?: number
  counts: Record<string, number>; biggest_blunder_ply: number | null
}

interface BackendOpeningInfo {
  eco: string; name: string; until_ply: number
}

interface BackendSummary {
  white: BackendSideSummary
  black: BackendSideSummary
  game_rating_algorithm?: string
  key_moments: number[]
  opening: BackendOpeningInfo | null
}

function camelMove(p: BackendMove): MoveReview {
  return {
    ply: p.ply, san: p.san, fenBefore: p.fen_before,
    evalBefore: p.eval_before, evalAfterPlayed: p.eval_after_played,
    bestMoveSan: p.best_move_san,
    winBefore: p.win_before, winAfterPlayed: p.win_after_played,
    ...(p.win_after_second === undefined
      ? {}
      : { winAfterSecond: p.win_after_second }),
    winDrop: p.win_drop, classification: p.classification as MoveReview['classification'],
    mateBefore: p.mate_before, mateAfterPlayed: p.mate_after_played,
  }
}

function camelSummary(p: BackendSummary): ReviewSummary {
  const side = (s: BackendSideSummary) => ({
    accuracy: s.accuracy,
    ...(s.game_rating == null ? {} : { gameRating: s.game_rating }),
    counts: s.counts as ReviewSummary['white']['counts'],
    biggestBlunderPly: s.biggest_blunder_ply,
  })
  const opening = p.opening
    ? { eco: p.opening.eco, name: p.opening.name, untilPly: p.opening.until_ply }
    : null
  return {
    white: side(p.white),
    black: side(p.black),
    ...(p.game_rating_algorithm == null
      ? {}
      : { gameRatingAlgorithm: p.game_rating_algorithm }),
    keyMoments: p.key_moments,
    opening,
  }
}

// ── Async review jobs ─────────────────────────────────────────────────────────
interface ReviewJobRef {
  id: string
  status: string
  engine: string | null
}

// Origin game coordinates, so the inbox can deep-link back to the viewer.
export interface ReviewMeta {
  source?: string
  userId?: string
  gameId?: string
  // Player ratings for the rating-aware classifier (k(elo)) — sent when the
  // games-list data already carries them; a pasted-PGN review with no rating
  // still works via the PGN's own Elo tags on the backend (see
  // review._resolve_ratings).
  whiteElo?: number
  blackElo?: number
}

export interface ReviewInboxItem {
  id: string
  source: string
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  white: string
  black: string
  reviewed: number
  totalPlies: number
  userId: string | null
  gameId: string | null
  accuracy: number | null
  // The player's sparse classification counts; null when unmatched or absent.
  counts: Partial<Record<Classification, number>> | null
  createdAt: string
  finishedAt: string | null
  depth: number
  multipv: number
  engine: string | null
  engineSource: 'backend' | 'frontend'
}

export interface ReviewSnapshot extends ReviewInboxItem {
  moves: MoveReview[]
  summary: ReviewSummary | null
  error: string | null
}

// The browser's own whole-game evals (engine/reviewPayload.ts). Complete →
// the backend classifies with no engine and stores the review done; anything
// short falls back to a backend search. Never carries a label.
export interface ReviewPayload {
  plies: ReviewPly[]
  engine: string
}

// Submit a review job. Dedups server-side on (pgn, depth, multipv) — a
// frontend-sourced request is also satisfied by a backend review of the same.
export async function createReview(
  pgn: string,
  depth: number,
  multipv: number,
  meta: ReviewMeta = {},
  payload?: ReviewPayload,
): Promise<ReviewJobRef> {
  return postJson<ReviewJobRef>(
    '/reviews',
    {
      pgn, depth, multipv,
      source: meta.source, user_id: meta.userId, game_id: meta.gameId,
      white_elo: meta.whiteElo, black_elo: meta.blackElo,
      engine: payload?.engine,
      plies: payload?.plies.map((p) => ({
        fen_before: p.fenBefore, fen_after: p.fenAfter,
        before_lines: p.beforeLines.map((l) => ({ uci: l.uci, cp: l.cp, mate: l.mate })),
        after_eval: p.afterEval,
      })),
    },
    () => new Error('Review failed'),
  )
}

// Grade a single deviation move (POST /reviews/move). One verdict, plain JSON
// (not a stream). `prevBeforeEval` is the previous ply's before-eval (white-POV
// pawns, i.e. MoveReview.evalBefore) seeding the classifier's opponent-swing
// input — omit for the first move off the game line. `signal` lets a superseded
// grade be aborted (latest-wins on a live branch).
// One frontend-supplied analysis line of the before-position: exactly one of
// cp/mate (white-POV, matching AnalysisLine), plus the line's UCI move. When a
// complete payload is attached the backend grades with NO Stockfish (see
// review.classify_move); omit it and the backend searches (Phase-1 parity).
export interface GradeLine {
  uci: string
  cp?: number
  mate?: number
}
export interface GradeMoveEval {
  cp?: number
  mate?: number
}

interface GradeMoveRequest {
  fenBefore: string
  uci: string
  whiteElo?: number
  blackElo?: number
  depth: number
  multipv: number
  prevBeforeEval?: number
  // The same seed as the previous position's rank-1 score, so a ply needn't wait
  // for the previous ply's verdict; at most one of the two.
  prevBefore?: GradeMoveEval
  // Optional frontend-eval payload (browser WASM search). Present + complete →
  // backend skips the engine; absent/partial → backend searches.
  beforeLines?: GradeLine[]
  afterEval?: GradeMoveEval
}

export async function gradeMove(req: GradeMoveRequest, signal?: AbortSignal): Promise<MoveReview> {
  const move = await postJson<BackendMove>(
    '/reviews/move',
    {
      fen_before: req.fenBefore, uci: req.uci,
      white_elo: req.whiteElo, black_elo: req.blackElo,
      depth: req.depth, multipv: req.multipv,
      prev_before_eval: req.prevBeforeEval,
      prev_before: req.prevBefore,
      before_lines: req.beforeLines?.map((l) => ({
        uci: l.uci, cp: l.cp, mate: l.mate,
      })),
      after_eval: req.afterEval,
    },
    () => new Error('Grade failed'),
    signal,
  )
  return camelMove(move)
}

interface BackendInboxItem {
  id: string; source: string; status: ReviewInboxItem['status']
  white: string; black: string; reviewed: number; total_plies: number
  user_id: string | null; game_id: string | null; accuracy: number | null
  counts: Record<string, number> | null
  created_at: string; finished_at: string | null
  depth: number; multipv: number
  engine: string | null
  engine_source: 'backend' | 'frontend'
}

interface BackendReviewSnapshot extends BackendInboxItem {
  moves: BackendMove[]
  summary: BackendSummary | null
  error: string | null
}

function camelInbox(r: BackendInboxItem): ReviewInboxItem {
  return {
    id: r.id, source: r.source, status: r.status,
    white: r.white, black: r.black, reviewed: r.reviewed, totalPlies: r.total_plies,
    userId: r.user_id, gameId: r.game_id, accuracy: r.accuracy,
    counts: r.counts as ReviewInboxItem['counts'],
    createdAt: r.created_at, finishedAt: r.finished_at,
    depth: r.depth, multipv: r.multipv,
    engine: r.engine, engineSource: r.engine_source,
  }
}

// The inbox: every submitted review, newest first. Scoped to a source/user/game
// when given — an unscoped call still returns everything.
export async function listReviews(
  source?: string,
  userId?: string,
  gameId?: string,
): Promise<ReviewInboxItem[]> {
  const res = await fetch(`${BASE}${routes.reviews(source, userId, gameId)}`)
  if (!res.ok) throw new Error('Failed to load reviews')
  const rows = (await res.json()) as BackendInboxItem[]
  return rows.map(camelInbox)
}

export async function getReview(id: string, signal: AbortSignal): Promise<ReviewSnapshot> {
  const res = await fetch(`${BASE}/reviews/${encodeURIComponent(id)}`, { signal })
  if (!res.ok) throw new Error('Review failed')
  const row = (await res.json()) as BackendReviewSnapshot
  return {
    ...camelInbox(row),
    moves: row.moves.map(camelMove),
    summary: row.summary === null ? null : camelSummary(row.summary),
    error: row.error,
  }
}

// Cancel (running/queued) or remove (terminal) a review job. Fire-and-forget.
export async function cancelReview(id: string): Promise<void> {
  try {
    await fetch(`${BASE}/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    // best-effort; local polling is already aborted by the caller
  }
}
