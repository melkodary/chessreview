import { test, expect, type Page } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { AnalyzeViewerPage } from '../pages/AnalyzeViewerPage'

const USER = 'rookiefan'
const GAME_ID = '123456789'
const AFTER_1_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_1_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('analysis stays idle at game start, then streams after the first move', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await expect(viewer.depthBadge()).toHaveCount(0)
  await expect(viewer.bestLines()).toHaveCount(0)

  await viewer.nextMove()
  // The "Analyzing..." status covers the window before the badge, so either
  // indicates streaming is live.
  const streaming = page.getByText('Analyzing...').or(viewer.depthBadge())
  await expect(streaming.first()).toBeVisible({ timeout: 15000 })
})

test('after final frame: 3 best-line entries visible', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()
  await expect(viewer.bestLines()).toHaveCount(3, { timeout: 15000 })
})

interface PanelSample { fen: string; rows: string[]; stale: boolean[] }

/** Record every DOM state the Best Lines panel passes through, keyed by the
 *  board's FEN. A blank flash lives between two React commits, so a retrying
 *  assertion would never see it — and picking the first sample at the new FEN
 *  reads the carried frame without racing the engine's first tick. */
async function watchPanel(page: Page) {
  await page.evaluate(() => {
    const seen: { fen: string; rows: string[]; stale: boolean[] }[] = []
    ;(window as unknown as { __panel: typeof seen }).__panel = seen
    const sample = () => {
      const els = [...document.querySelectorAll('[data-testid="best-line"]')]
      seen.push({
        fen: document.querySelector('[data-testid="board"]')?.getAttribute('data-fen') ?? '',
        rows: els.map((e) =>
          e.querySelector('[data-testid="best-line-moves"]')?.textContent?.trim() ?? ''),
        stale: els.map((e) => e.getAttribute('data-stale') === 'true'),
      })
    }
    sample()
    new MutationObserver(sample).observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true,
    })
  })
}

const readPanel = (page: Page): Promise<PanelSample[]> =>
  page.evaluate(() => (window as unknown as { __panel: PanelSample[] }).__panel)

/** Let the search finish before the move under test, so the lines and arrows
 *  read here are the ones still on screen when the move lands. */
async function settleAnalysis(page: Page, viewer: AnalyzeViewerPage) {
  await expect(viewer.bestLines()).toHaveCount(3, { timeout: 15000 })
  await expect(viewer.settledDepthBadge()).toBeVisible({ timeout: 20000 })
}

// The shortest offered analysis budget, so settleAnalysis costs ~5s not ~20s.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chessreview-analysis-time-ms', '5000')
  })
})

test('playing the top line\'s first move carries its tail over without a blank', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()
  await settleAnalysis(page, viewer)

  const fenBefore = (await viewer.board().getAttribute('data-fen'))!
  // The top arrow is the top line's first move, so tapping it is exactly the
  // carry-over case — and unlike the SAN text it is already from/to squares.
  const [from, to] = (await viewer.arrows().first().getAttribute('data-arrow'))!.split('-')
  await watchPanel(page)

  await viewer.tapMove(from, to)
  await expect(viewer.exploreBanner()).toBeVisible()
  const fenAfter = (await viewer.board().getAttribute('data-fen'))!

  const seen = await readPanel(page)
  // Never collapsed to the Analyzing... status row on the way through.
  expect(Math.min(...seen.map((s) => s.rows.length))).toBe(3)

  const before = seen.filter((s) => s.fen === fenBefore).at(-1)!
  const after = seen.find((s) => s.fen === fenAfter)!
  // Row 1 is the played line's tail, shown before the engine reported anything;
  // the held siblings keep their order behind it, dimmed.
  expect(after.rows[0]).toBe(before.rows[0].split(' ').slice(1).join(' '))
  expect(after.rows.slice(1)).toEqual(before.rows.slice(1))
  expect(after.stale).toEqual([false, true, true])
})

test('stepping back holds the previous lines, dimmed, instead of blanking', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  // Ply by ply: the nav handler closes over the current index, so two presses
  // in the same tick land as one. Reaching ply 2 matters — stepping back from
  // ply 1 disables analysis entirely (the untouched game start).
  await viewer.nextMove()
  await expect(viewer.board()).toHaveAttribute('data-fen', AFTER_1_E4)
  await viewer.nextMove()
  await expect(viewer.board()).toHaveAttribute('data-fen', AFTER_1_E4_E5)
  await settleAnalysis(page, viewer)

  const fenBefore = (await viewer.board().getAttribute('data-fen'))!
  await watchPanel(page)
  await page.keyboard.press('ArrowLeft')
  await expect(viewer.board()).not.toHaveAttribute('data-fen', fenBefore)
  const fenAfter = (await viewer.board().getAttribute('data-fen'))!

  const seen = await readPanel(page)
  expect(Math.min(...seen.map((s) => s.rows.length))).toBe(3)

  const before = seen.filter((s) => s.fen === fenBefore).at(-1)!
  const after = seen.find((s) => s.fen === fenAfter)!
  // No held line's first move reaches the previous position, so every row is
  // held as-is and marked stale.
  expect(after.rows).toEqual(before.rows)
  expect(after.stale).toEqual([true, true, true])
})

test('depth badge stays visible after analysis settles', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()
  // Once the final frame lands the badge stops climbing and takes the calm
  // settled styling rather than disappearing.
  await expect(viewer.bestLines()).toHaveCount(3, { timeout: 15000 })
  await expect(viewer.depthBadge()).toBeVisible()
})

// A tab flip used to abort the search, and the return re-ran it with the same budget:
// the badge sat frozen at the old depth until that budget ran out. Now the search
// runs on while Review is open, and the return shows where it got to.
test('a tab flip keeps the search running: the return shows its result, not a frozen re-search', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()
  await expect(viewer.depthBadge()).toBeVisible({ timeout: 15000 })
  await expect(viewer.settledDepthBadge()).toHaveCount(0) // leave mid-search
  const left = Number((await viewer.depthBadge().textContent())!.slice(1))

  await viewer.openTab('Review')
  await page.waitForTimeout(8000) // the time away is the scenario: long enough to finish
  await viewer.openTab('Analysis')

  await expect(viewer.settledDepthBadge()).toBeVisible({ timeout: 1000 })
  expect(Number((await viewer.depthBadge().textContent())!.slice(1))).toBeGreaterThan(left)
})
