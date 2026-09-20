import { test, expect } from '@playwright/test'
import { mockBackend, REVIEW_SNAPSHOTS } from '../mocks/backend'
import { GameViewerPage } from '../pages/GameViewerPage'
import { AnalyzeViewerPage } from '../pages/AnalyzeViewerPage'

const USER = 'rookiefan'
const GAME_ID = '123456789'

// After 1.e4 — the position the Review walkthrough parks on after Start Review.
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('user runs a review, sees the summary, then walks through it', async ({ page }) => {
  // The in-game button sweeps the game in the browser first (WASM boot + two
  // passes at the e2e depths) and only then POSTs the evals; the mocked job
  // answers after that. Budget the real engine, not the mock.
  test.setTimeout(90_000)
  // Provenance: this job is frontend-sourced (the POST it answers carries the
  // browser's own evals), so the mocked snapshots say so too.
  await mockBackend(page, {
    reviewQueue: () => [],
    reviewSnapshots: () => REVIEW_SNAPSHOTS.map((s) => ({
      ...s, engine: 'Stockfish 19 Lite', engine_source: 'frontend',
    })),
  })
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)

  let posted: { plies?: unknown[]; engine?: string } | null = null
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/reviews$/.test(new URL(req.url()).pathname)) posted = req.postDataJSON()
  })

  await page.getByRole('button', { name: /^start review$/i }).click()
  // Running from the first frame: the sweep's own progress drives the bar.
  await expect(page.getByText(/^Analyzing… \d+ \/ 20$/)).toBeVisible()
  // Done → summary screen: scoreboard accuracy per side.
  await expect(page.getByText('95.0').first()).toBeVisible({ timeout: 60000 })
  await expect(page.getByText('60.0').first()).toBeVisible()
  // The review was frontend-sourced: one POST, carrying every ply's evals.
  expect(posted!.engine).toBe('Stockfish 19 Lite')
  expect(posted!.plies).toHaveLength(20)
  // Provenance marker on the header, keyed on engine_source, not the label.
  await expect(page.getByTestId('review-provenance')).toBeVisible()

  // Summary screen has no move list yet (walkthrough only).
  await expect(page.getByTestId('move-item')).toHaveCount(0)

  // Start Review → guided walkthrough: the board badge carries the current
  // ply's full verdict (best, ply 1) — but the move list only labels the six
  // special classifications, so "best" never appears there (unlike "blunder").
  await page.getByRole('button', { name: /start review/i }).click()
  await expect(viewer.board().locator('[data-classification="best"]')).toBeVisible()
  await expect(viewer.moveList().locator('[data-classification="best"]')).toHaveCount(0)
  await expect(viewer.moveList().locator('[data-classification="blunder"]').first()).toBeVisible()

  // Back arrow returns to the summary screen.
  await page.getByRole('button', { name: /summary/i }).click()
  await expect(page.getByRole('button', { name: /start review/i })).toBeVisible()
})

test('matching review renders rerun as visibly disabled', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chessreview-review-depth', '18')
    localStorage.setItem('chessreview-review-multipv', '3')
  })
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('95.0').first()).toBeVisible({ timeout: 5000 })

  const rerun = page.getByRole('button', { name: /re-run review/i })
  await expect(rerun).toBeDisabled()
  await expect(rerun).toHaveCSS('opacity', '0.45')
})

test('deviating in the Review walkthrough grades the branch in place (no tab switch); the branch survives a tab flip', async ({ page }) => {
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)

  // Capture the deviation-grade request: by default the browser's own WASM
  // search feeds the classifier, so the request carries a before_lines/after_eval
  // eval payload (the backend would then skip Stockfish).
  let moveBody: { before_lines?: unknown[]; after_eval?: unknown } | null = null
  let moveRequests = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/reviews\/move$/.test(new URL(req.url()).pathname)) {
      moveBody = req.postDataJSON()
      moveRequests += 1
    }
  })

  await expect(page.getByText('95.0').first()).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /start review/i }).click()
  await expect(viewer.board()).toHaveAttribute('data-fen', AFTER_E4_FEN)

  // Deviate from the game's actual 1...e5 with 1...c5 — graded in place, on Review.
  await viewer.tapMove('c7', 'c5')

  // No tab switch: the variation stays on Review and shows in the branch list.
  await expect(page).toHaveURL(/\/review/)
  await expect(page.getByTestId('explore-banner')).toBeVisible()
  await expect(page.getByTestId('branch-move')).toHaveText(['c5'])

  // While grading is in flight the board badges the moved piece with a pending
  // spinner (not nothing) — the Phase-1 board-badge gap, now fixed.
  // (Engine boot + search can take a moment; the verdict below supersedes it.)

  // The branch move earns a verdict from POST /reviews/move (mocked 'mistake'):
  // the icon shows next to it in the list and the board badges the played move.
  // Timeout is generous: the frontend WASM engine boots + searches first.
  await expect(
    page.getByTestId('branch-move').locator('[data-classification="mistake"]'),
  ).toBeVisible({ timeout: 20000 })
  await expect(viewer.board().locator('[data-classification="mistake"]')).toBeVisible()

  // The grade was FE-sourced: the request carried the browser's evals.
  await expect.poll(() => (moveBody?.before_lines?.length ?? 0), { timeout: 20000 }).toBeGreaterThanOrEqual(2)
  expect(moveBody!.after_eval).toBeTruthy()

  // Flip to Analysis and back: Review carries its branch out, and gets it back
  // on return (nothing was explored on Analysis, so the snapshot is identical).
  const gradesBefore = moveRequests
  await page.getByRole('link', { name: 'Analysis', exact: true }).click()
  await expect(page.getByTestId('branch-move')).toHaveText(['c5'])
  await page.getByRole('link', { name: 'Review', exact: true }).click()
  await expect(page.getByTestId('branch-move')).toHaveText(['c5'])

  // The restored branch keeps its verdict: grades are FEN-keyed, so the round
  // trip re-grades nothing — the icon is still there and no new request fired.
  await expect(
    page.getByTestId('branch-move').locator('[data-classification="mistake"]'),
  ).toBeVisible()
  expect(moveRequests).toBe(gradesBefore)
})

test('landing on Analysis shows the existing review annotations without starting one', async ({ page }) => {
  let posted = false
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/reviews$/.test(new URL(req.url()).pathname)) posted = true
  })

  const analyze = new AnalyzeViewerPage(page)
  await analyze.goto(USER, GAME_ID)

  // Analysis is the landing tab and never starts a review — it only reads
  // whatever the backend's GET /reviews?game_id= already has (mocked here as
  // a finished job). The move list's icon (blunder, ply 2) renders as soon as
  // the hydrated moves land, no navigation or POST required.
  await expect(analyze.moveList().locator('[data-classification="blunder"]').first()).toBeVisible({ timeout: 5000 })
  expect(posted).toBe(false)

  // The board badge is per-ply — step to ply 1 (best) to see it.
  await analyze.nextMove()
  await expect(analyze.badge()).toHaveAttribute('data-badge', 'e4-best')

  // Deviate from the game's actual 1...e5 with 1...c5: the badge is a verdict
  // on the played move, and a branch position has no review data for it.
  await analyze.tapMove('c7', 'c5')
  await expect(analyze.exploreBanner()).toBeVisible()
  await expect(analyze.badge()).toHaveCount(0)

  // Reset to the game line: the badge for ply 1 returns.
  await analyze.resetExploration()
  await expect(analyze.badge()).toHaveAttribute('data-badge', 'e4-best')
})
