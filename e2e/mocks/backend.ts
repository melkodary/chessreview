import { type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixturesDir = join(import.meta.dirname, '../fixtures')

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8')) as T
}

// The mock's own game shape; served as Lichess NDJSON/JSON below.
export interface FixtureGame {
  id: string
  white: { username: string; rating: number }
  black: { username: string; rating: number }
  winner?: 'white' | 'black'
  end_time: number
  pgn: string
}

const gamesFixture = loadFixture<{ games: FixtureGame[] }>('games.json')

function toLichess(g: FixtureGame) {
  const side = (p: FixtureGame['white']) => ({ user: { name: p.username }, rating: p.rating })
  return {
    id: g.id,
    players: { white: side(g.white), black: side(g.black) },
    winner: g.winner,
    pgn: g.pgn,
    createdAt: g.end_time * 1000,
    lastMoveAt: g.end_time * 1000,
  }
}

const REVIEW_MOVES = [
  {
      ply: 1, san: 'e4', fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      eval_before: 0.0, eval_after_played: 0.2, eval_after_best: 0.2,
      best_move_san: 'e4',
      win_before: 50.0, win_after_played: 52.0, win_drop: 0.0,
      classification: 'best',
      mate_before: null, mate_after_played: null,
  },
  {
      ply: 2, san: 'e5', fen_before: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      eval_before: 0.2, eval_after_played: -1.5, eval_after_best: 0.2,
      best_move_san: 'c5',
      win_before: 48.0, win_after_played: 25.0, win_drop: 23.0,
      classification: 'blunder',
      mate_before: null, mate_after_played: null,
  },
]

const REVIEW_SUMMARY = {
  white: { accuracy: 95.0, counts: { best: 1 }, biggest_blunder_ply: null },
  black: { accuracy: 60.0, counts: { blunder: 1 }, biggest_blunder_ply: 2 },
  key_moments: [2],
  opening: null,
}

// engine_source defaults to 'backend' here — same fallback a pre-Phase-1 NULL
// row reads as. Phase 2's provenance marker keys on it (see ReviewSummary,
// GameList); a test that needs the frontend variant overrides it explicitly.
export const REVIEW_SNAPSHOTS = [
  {
    id: 'job-e2e', source: 'lichess', status: 'running',
    white: 'rookiefan', black: 'opponent', reviewed: 1, total_plies: 2,
    user_id: 'rookiefan', game_id: '123', accuracy: null,
    created_at: new Date().toISOString(), finished_at: null,
    depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
    moves: REVIEW_MOVES.slice(0, 1), summary: null, error: null,
  },
  {
    id: 'job-e2e', source: 'lichess', status: 'done',
    white: 'rookiefan', black: 'opponent', reviewed: 2, total_plies: 2,
    user_id: 'rookiefan', game_id: '123', accuracy: 95.0,
    created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
    moves: REVIEW_MOVES, summary: REVIEW_SUMMARY, error: null,
  },
]

const REVIEW_QUEUE_ITEMS = [
  {
    id: 'job-done', source: 'lichess', status: 'done',
    white: 'rookiefan', black: 'opponent', reviewed: 2, total_plies: 2,
    user_id: 'rookiefan', game_id: '123', accuracy: 95.0, counts: { best: 1 },
    created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
  },
  {
    id: 'job-running', source: 'lichess', status: 'running',
    white: 'rookiefan', black: 'rival', reviewed: 1, total_plies: 4,
    user_id: null, game_id: null, accuracy: null, counts: null,
    created_at: new Date().toISOString(), finished_at: null,
    depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
  },
]

// A single deviation-move grade (POST /reviews/move). Fixed 'mistake' verdict
// for the branch move so the branch list + board badge have something to show.
const MOVE_GRADE = {
  ply: 0, san: 'c5',
  fen_before: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  eval_before: 0.2, eval_after_played: 1.2, best_move_san: 'c5',
  win_before: 48.0, win_after_played: 35.0, win_drop: 13.0,
  classification: 'mistake', mate_before: null, mate_after_played: null,
}

const EXPLAIN_TRACE = {
  label: 'best',
  header: {
    san: 'e4', color: 'white', elo: 1500, k: 0.00425,
    source: 'review row', stored_label: 'best',
    cp: {
      before_opp: null, before: 0, after_played: 20, after_second: null,
    },
  },
  families: [{
    name: 'forced',
    state: 'no',
    arms: [{
      name: 'forced',
      state: 'no',
      blocked_by: 'is_only_legal_move',
      checks: [{
        kind: 'check',
        name: 'is_only_legal_move',
        lhs: false,
        op: 'is',
        rhs: true,
        state: 'fail',
        margin: null,
      }],
    }],
  }, {
    name: 'brilliant',
    state: 'no',
    arms: [{
      name: 'brilliant',
      state: 'no',
      blocked_by: 'is_sacrifice',
      checks: [{
        kind: 'check',
        name: 'is_sacrifice',
        lhs: false,
        op: 'is',
        rhs: true,
        state: 'fail',
        margin: null,
      }, {
        kind: 'check',
        name: 'move_created_offer',
        lhs: true,
        op: 'is',
        rhs: true,
        state: 'ok',
        margin: null,
      }, {
        kind: 'check',
        name: 'good_tol',
        lhs: 2.9,
        op: '<=',
        rhs: 2,
        state: 'fail',
        margin: -0.9,
      }, {
        kind: 'check',
        name: 'before',
        lhs: 49.8,
        op: '<',
        rhs: 88,
        state: 'ok',
        margin: 38.2,
      }],
    }],
  }],
  k_panel: {
    at_1000: 0.003,
    at_2000: 0.0055,
    clamp: [0.0025, 0.0065],
    active: 0.00425,
    clamped: false,
    rows: [{
      feature: 'before',
      cp: 0,
      at_1000: 50,
      at_k: 50,
      at_2000: 50,
    }],
  },
  band_for: { label: 'best', drop: 0 },
  partial: ['after_second'],
}

// GET /stats/classifier — the header stats menu's benchmark panel. Fetched only
// once that menu is opened; kept so a spec that opens it does not eat a 404.
const CLASSIFIER_STATS = {
  generated_at: '2026-07-31',
  corpus: { games: 700, elo_min: 223, elo_max: 2453 },
  bands: [
    {
      key: 'all', label: 'All',
      agreement: { exact: 0.6337, within_one: 0.9453 },
      labels: [
        { label: 'brilliant', n: 96, precision: 0.4752, recall: 0.5 },
        { label: 'great', n: 1547, precision: 0.5763, recall: 0.51 },
        { label: 'miss', n: 1882, precision: 0.6687, recall: 0.517 },
        { label: 'blunder', n: 1121, precision: 0.5622, recall: 0.7502 },
      ],
    },
    {
      key: '<900', label: '<900',
      agreement: { exact: 0.6268, within_one: 0.94 },
      labels: [
        { label: 'brilliant', n: 21, precision: 0.6842, recall: 0.619 },
        { label: 'great', n: 354, precision: 0.5301, recall: 0.3729 },
        { label: 'miss', n: 414, precision: 0.6361, recall: 0.5193 },
        { label: 'blunder', n: 265, precision: 0.6701, recall: 0.7358 },
      ],
    },
    {
      key: '900-1300', label: '900–1300',
      agreement: { exact: 0.643, within_one: 0.9532 },
      labels: [
        { label: 'brilliant', n: 16, precision: 0.3571, recall: 0.625 },
        { label: 'great', n: 387, precision: 0.5094, recall: 0.491 },
        { label: 'miss', n: 612, precision: 0.6942, recall: 0.5637 },
        { label: 'blunder', n: 385, precision: 0.6422, recall: 0.774 },
      ],
    },
    {
      key: '1300-1800', label: '1300–1800',
      agreement: { exact: 0.6309, within_one: 0.9459 },
      labels: [
        { label: 'brilliant', n: 19, precision: 0.2609, recall: 0.3158 },
        { label: 'great', n: 360, precision: 0.5988, recall: 0.5722 },
        { label: 'miss', n: 463, precision: 0.6609, recall: 0.4924 },
        { label: 'blunder', n: 259, precision: 0.516, recall: 0.749 },
      ],
    },
    {
      key: '1800+', label: '1800+',
      agreement: { exact: 0.6291, within_one: 0.9374 },
      labels: [
        { label: 'brilliant', n: 40, precision: 0.6129, recall: 0.475 },
        { label: 'great', n: 446, precision: 0.6476, recall: 0.5852 },
        { label: 'miss', n: 393, precision: 0.6727, recall: 0.4707 },
        { label: 'blunder', n: 212, precision: 0.4219, recall: 0.7264 },
      ],
    },
  ],
}

export interface BackendMocks {
  games: () => { games: FixtureGame[] }
  reviewSnapshots: () => object[]
  reviewQueue: () => object
  moveGrade: () => object
  explainTrace: () => object
  classifierStats: () => object
}

const DEFAULT_MOCKS: BackendMocks = {
  games: () => gamesFixture,
  reviewSnapshots: () => REVIEW_SNAPSHOTS,
  reviewQueue: () => REVIEW_QUEUE_ITEMS,
  moveGrade: () => MOVE_GRADE,
  explainTrace: () => EXPLAIN_TRACE,
  classifierStats: () => CLASSIFIER_STATS,
}

export async function mockBackend(
  page: Page,
  overrides: Partial<BackendMocks> = {},
): Promise<void> {
  const mocks = { ...DEFAULT_MOCKS, ...overrides }
  const reviewSnapshots = mocks.reviewSnapshots()
  let reviewSnapshotIndex = 0

  // Playwright matches routes LIFO (last-registered wins). Register general
  // routes first so more-specific ones added after take precedence.

  // Lichess: a user's games as NDJSON (newest first, honouring `max`), and one
  // game by id as JSON.
  await page.route('**/lichess.org/api/games/user/**', async (route) => {
    const max = Number(new URL(route.request().url()).searchParams.get('max') ?? Infinity)
    const body = mocks.games().games
      .slice().sort((a, b) => b.end_time - a.end_time).slice(0, max)
      .map((g) => JSON.stringify(toLichess(g))).join('\n')
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body })
  })
  await page.route('**/lichess.org/game/export/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()
    const game = mocks.games().games.find((g) => g.id === id)
    if (!game) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toLichess(game)) })
  })

  // Async review jobs. POST /reviews submits; GET /reviews/:id returns the next
  // durable snapshot; DELETE cancels. GET /reviews is scoped
  // (`?source=&user_id=`) — `*` after `reviews` (no `/`) still
  // matches the bare path and any query string, but not `/reviews/<id>`.
  await page.route('**/reviews*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'job-e2e', status: 'queued', engine: null,
        }),
      })
    } else {
      // GET /reviews — the review queue list
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(mocks.reviewQueue()),
      })
    }
  })

  await page.route('**/reviews/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' })
      return
    }
    const snapshot = reviewSnapshots[
      Math.min(reviewSnapshotIndex, reviewSnapshots.length - 1)
    ]
    reviewSnapshotIndex += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    })
  })

  // POST /reviews/move — grade one deviation move. Registered last so it wins
  // over the general `**/reviews/*` acknowledge handler above (LIFO).
  await page.route('**/reviews/move', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(mocks.moveGrade()),
    })
  })

  await page.route('**/stats/classifier', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(mocks.classifierStats()),
    })
  })

  await page.route('**/reviews/explain', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mocks.explainTrace()),
    })
  })
}
