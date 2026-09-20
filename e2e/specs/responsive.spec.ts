import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameViewerPage } from '../pages/GameViewerPage'

const USER = 'rookiefan'
const GAME_ID = '123456789'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('narrow viewport stacks the board above the panel without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await viewer.board().waitFor()

  const boardPanel = page.getByTestId('board-panel')
  const sidePanel = page.getByTestId('side-panel')

  // react-chessboard settles its responsive size after the container appears.
  // Read both rects in one frame and wait for the final stacked geometry.
  await expect.poll(async () => {
    return page.evaluate(() => {
      const board = document.querySelector('[data-testid="board-panel"]')
      const side = document.querySelector('[data-testid="side-panel"]')
      if (!board || !side) return false
      const boardRect = board.getBoundingClientRect()
      const sideRect = side.getBoundingClientRect()
      return sideRect.y >= boardRect.y + boardRect.height - 1
    })
  }).toBe(true)

  // Nothing spills past the viewport width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('on a phone the move controls stay on screen while the board is in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)

  await expect(page.getByText('95.0').first()).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /start review/i }).click()
  await viewer.board().waitFor()

  // The walkthrough auto-scrolls to the active move; go back to the top so the
  // board is on screen — this is the state where the nav used to be below the
  // fold (it's the last child of a panel taller than the viewport).
  await page.evaluate(() => document.querySelector('[class*="outlet"]')?.scrollTo(0, 0))

  const nav = page.getByTestId('nav-row')
  const boardBox = await viewer.board().boundingBox()
  const navBox = await nav.boundingBox()
  expect(boardBox).not.toBeNull()
  expect(navBox).not.toBeNull()

  // Board visible AND nav within the viewport: sticky pins it to the bottom.
  expect(boardBox!.y).toBeLessThan(667)
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(667 + 1)
})
