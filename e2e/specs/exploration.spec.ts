import { test, expect, type Page } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { AnalyzeViewerPage } from '../pages/AnalyzeViewerPage'

const USER = 'rookiefan'
const GAME_ID = '123456789'
const depthWarnings = new WeakMap<Page, string[]>()

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

test.beforeEach(async ({ page }) => {
  const warnings: string[] = []
  depthWarnings.set(page, warnings)
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Maximum update depth exceeded')) {
      warnings.push(message.text())
    }
  })
  await mockBackend(page)
})

test.afterEach(async ({ page }) => {
  expect(depthWarnings.get(page), 'analysis must not trigger a React update loop').toEqual([])
})

// The branch state machine + clearing rules are unit-tested; this proves the
// real wiring: a tap-move on the Analyze board starts a live variation (engine
// re-runs on the explored position), shows it in the move list, and Reset
// restores the game.
test('explore a variation by tap-move, then reset to the game', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)

  // Untouched start position stays idle.
  await expect(viewer.board()).toHaveAttribute('data-fen', START_FEN)
  await expect(viewer.exploreBanner()).toHaveCount(0)
  await expect(viewer.arrows()).toHaveCount(0)
  await expect(page.getByText('No analysis yet.')).toBeVisible()

  // Tap 1.e4 to deviate into a variation and start analysis.
  await viewer.tapMove('e2', 'e4')

  // Board followed the explored position; the variation shows in the move list.
  await expect(viewer.board()).not.toHaveAttribute('data-fen', START_FEN)
  await expect(viewer.board()).toHaveAttribute('data-fen', /\/4P3\/.* b /)
  await expect(viewer.exploreBanner()).toBeVisible()
  await expect(viewer.branchMoves()).toHaveText(['e4'])

  // Engine re-ran on the explored position: best-line arrows now reflect
  // Black's reply (every legal Black move starts from rank 7/8 here), proving
  // the in-browser engine re-analyzed the new side-to-move position.
  await expect
    .poll(
      async () => {
        const attrs = await viewer
          .arrows()
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-arrow')))
        return attrs.length === 3 && attrs.every((a) => /^[a-h][78]-/.test(a ?? ''))
      },
      { timeout: 15000 },
    )
    .toBe(true)

  // Reset restores the game line: branch gone, board back at the start.
  await viewer.resetExploration()
  await expect(viewer.exploreBanner()).toHaveCount(0)
  await expect(viewer.branchMoves()).toHaveCount(0)
  await expect(viewer.board()).toHaveAttribute('data-fen', START_FEN)
  await expect(viewer.arrows()).toHaveCount(0)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
})

test('clicking a fresh analysis line plays only its first move', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()
  await expect(viewer.bestLines()).toHaveCount(3, { timeout: 15000 })

  const fenBefore = await viewer.board().getAttribute('data-fen')
  await viewer.playBestLine()

  await expect(viewer.board()).not.toHaveAttribute('data-fen', fenBefore!)
  await expect(viewer.exploreBanner()).toBeVisible()
  await expect(viewer.branchMoves()).toHaveCount(1)
})

// Asymmetric tab carry. The rules are unit-tested; this proves the wiring
// through real tab links: Review's branch reaches Analysis, and Analysis'
// scratch plies never make it back.
test('a Review branch carries to Analysis; Analysis plies do not carry back', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.gotoReview(USER, GAME_ID)

  // Deviate on Review: 1.e4 becomes the Review branch.
  await viewer.tapMove('e2', 'e4')
  await expect(viewer.branchMoves()).toHaveText(['e4'])

  // Review → Analysis carries it.
  await viewer.openTab('Analysis')
  await expect(viewer.branchMoves()).toHaveText(['e4'])

  // Explore further on Analysis — this is scratch work.
  await viewer.tapMove('e7', 'e5')
  await expect(viewer.branchMoves()).toHaveText(['e4', 'e5'])

  // Analysis → Review restores the branch as Review last saw it: 1...e5 is gone
  // and the board is back on the position Review was showing.
  await viewer.openTab('Review')
  await expect(viewer.branchMoves()).toHaveText(['e4'])
  await expect(viewer.board()).toHaveAttribute('data-fen', /\/4P3\/.* b /)
})

// Branch-sourced eval bar on Review. Before this, deviating on Review made the bar vanish —
// `useReviewOverlay` returned `evalBar: null` for the whole time `exploring`
// was true, even though the branch is graded (POST /reviews/move) and the
// grade carries the eval the bar needs.
test('deviating on Review shows a branch-sourced eval bar; stepping back to the fork restores the game-line value', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.gotoReview(USER, GAME_ID)

  // Existing mocked review hydrates quickly; wait for its game-line value.
  await expect(page.getByText('95.0').first()).toBeVisible({ timeout: 5000 })

  // Still on the game line (the fork): the bar reads the game review data —
  // ply 1 (e4) hasn't been played yet, so it shows the pre-move eval, 0.0.
  await expect(viewer.evalBar()).toBeVisible()
  await expect(viewer.evalBar().locator('span')).toHaveText('0.0')

  // Deviate: today this is exactly where the bar used to disappear.
  await viewer.tapMove('e2', 'e4')
  await expect(viewer.exploreBanner()).toBeVisible()
  await expect(viewer.evalBar()).toBeVisible()
  // The branch ply is still grading (real WASM engine boot + search) — the bar
  // holds the fork's last value rather than blanking, proving the freeze.
  await expect(viewer.evalBar().locator('span')).toHaveText('0.0')

  // The grade lands (mocked verdict: eval_after_played 1.2) and the label
  // updates to it — the branch's own number, not the game line's.
  await expect(viewer.evalBar().locator('span')).toHaveText('+1.2', { timeout: 20000 })

  // Step back to the fork: the branch survives (still exploring), and the bar
  // seamlessly reverts to the game-line value.
  await page.getByText('◀').click()
  await expect(viewer.exploreBanner()).toBeVisible()
  await expect(viewer.evalBar().locator('span')).toHaveText('0.0')
})
