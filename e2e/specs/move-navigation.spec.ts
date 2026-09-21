import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameViewerPage } from '../pages/GameViewerPage'
import gamesFixture from '../fixtures/games.json' with { type: 'json' }

const USER = 'rookiefan'
const GAME_ID = '123456789'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('ArrowRight advances one move', async ({ page }) => {
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await viewer.board().waitFor()
  await expect(page).toHaveURL(/move=0/)

  const fenBefore = await page.evaluate(() =>
    document.querySelector('[data-fen]')?.getAttribute('data-fen') ?? ''
  )

  await viewer.nextMove()

  await expect.poll(async () => {
    return page.evaluate(() =>
      document.querySelector('[data-fen]')?.getAttribute('data-fen') ?? ''
    )
  }).not.toBe(fenBefore)
  await expect(page).toHaveURL(/move=1/)
})

test('?move=N deep-links to ply N and marks the move active', async ({ page }) => {
  const viewer = new GameViewerPage(page)
  // Analysis tab keeps a move list at rest; Review opens on its intro.
  await page.goto(`/${USER}/games/${GAME_ID}/analyze?source=lichess&move=4`)
  await viewer.board().waitFor()

  // Ply 4 means 4 moves played — board is not at starting position
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const fen = await viewer.board().getAttribute('data-fen')
  expect(fen).not.toBe(startFen)

  // 4th move-item (index 3) should be active in the move list
  const activeItem = page.getByTestId('move-item').nth(3)
  await expect(activeItem).toHaveClass(/active/)
})

test('tabs preserve move and mainline navigation replaces browser history', async ({ page }) => {
  const viewer = new GameViewerPage(page)
  await page.goto(`/${USER}/games/${GAME_ID}/analyze?source=lichess&move=2`)
  await viewer.board().waitFor()

  const reviewTab = page.getByRole('link', { name: 'Review', exact: true })
  await reviewTab.click()
  await expect(page).toHaveURL(/\/review\?source=lichess&move=2$/)
  await expect(reviewTab).toHaveAttribute('aria-current', 'page')

  await viewer.nextMove()
  await expect(page).toHaveURL(/\/review\?source=lichess&move=3$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/analyze\?source=lichess&move=2$/)
})

test('export controls copy the displayed FEN and original PGN', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const viewer = new GameViewerPage(page)
  await page.goto(`/${USER}/games/${GAME_ID}/analyze?source=lichess&move=4`)
  await viewer.board().waitFor()
  const displayedFen = await viewer.board().getAttribute('data-fen')
  expect(displayedFen).not.toBeNull()

  await page.getByRole('button', { name: 'Copy FEN' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(displayedFen)

  await page.getByRole('button', { name: 'Copy PGN' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(gamesFixture.games[0].pgn)
})
