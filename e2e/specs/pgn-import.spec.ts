import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import gamesFixture from '../fixtures/games.json' with { type: 'json' }

const PGN = gamesFixture.games[1].pgn // opponent2 (white) vs rookiefan (black)

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('paste a PGN, review as Black, and the game survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PGN' }).click()
  await expect(page.getByPlaceholder('Username')).toHaveCount(0)

  await page.getByLabel('PGN', { exact: true }).fill(PGN)
  await page.getByRole('button', { name: 'As Black' }).click()
  await page.getByRole('button', { name: 'Import' }).click()

  await expect(page).toHaveURL(/\/rookiefan\/games\/[0-9a-f]{16}\/review\?source=pgn/)
  await expect(page.getByText('PGN', { exact: true })).toBeVisible() // header badge
  await expect(page.getByTestId('board')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('board')).toBeVisible()

  await page.getByRole('link', { name: /rookiefan's games/i }).click()
  await expect(page).toHaveURL(/\/rookiefan\/games\?source=pgn/)
  await expect(page.getByTestId('game-row')).toHaveCount(1)
})

test('rejects text that is not a PGN', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PGN' }).click()
  await page.getByLabel('PGN', { exact: true }).fill('this is not a game')
  await page.getByRole('button', { name: 'Import' }).click()
  await expect(page.getByRole('alert')).toHaveText('Not a valid PGN')
  await expect(page).toHaveURL('/')
})
