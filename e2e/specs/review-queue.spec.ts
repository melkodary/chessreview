import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameListPage } from '../pages/GameListPage'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('/inbox redirects to home', async ({ page }) => {
  await page.goto('/inbox')
  await expect(page).toHaveURL('/')
})

test('game list shows a Review button per card', async ({ page }) => {
  const list = new GameListPage(page)
  await list.gotoGames('rookiefan')
  const btns = page.getByTestId('review-btn')
  // 3 game rows, each should have a review button
  await expect(btns).toHaveCount(3)
})

test('clicking Review on a card enqueues a review job', async ({ page }) => {
  await page.route('**/reviews*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'job-new', status: 'queued' }),
      })
    } else {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }
  })

  const list = new GameListPage(page)
  await list.gotoGames('rookiefan')
  // Assert on the awaited request itself, not a flag set inside the route
  // handler — the request event fires before the handler runs, so a flag
  // races the assertion (this test used to flake exactly that way).
  const postReq = page.waitForRequest(
    (r) => r.url().includes('/reviews') && r.method() === 'POST',
  )
  await page.getByTestId('review-btn').first().click()
  const req = await postReq
  const body = req.postDataJSON() as Record<string, unknown>
  expect(typeof body.pgn).toBe('string')
  // Games-list submits carry the players' ratings for the backend's
  // rating-aware classifier (newest game first: rookiefan 3250 vs opponent3 3100).
  expect(body.white_elo).toBe(3250)
  expect(body.black_elo).toBe(3100)
})

test('inbox row shows a provenance marker for a frontend-sourced review, none for backend', async ({ page }) => {
  await mockBackend(page, {
    reviewQueue: () => [
      {
        id: 'fe-job', source: 'lichess', status: 'done',
        white: 'rookiefan', black: 'opponent1', reviewed: 10, total_plies: 10,
        user_id: 'rookiefan', game_id: '123456789', accuracy: 95.0,
        created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        depth: 18, multipv: 3, engine: 'Stockfish 19 Lite', engine_source: 'frontend',
      },
      {
        id: 'be-job', source: 'lichess', status: 'done',
        white: 'opponent2', black: 'rookiefan', reviewed: 10, total_plies: 10,
        user_id: 'rookiefan', game_id: '123456790', accuracy: 90.0,
        created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
      },
    ],
  })
  const list = new GameListPage(page)
  await list.gotoGames('rookiefan')

  const feRow = page.getByTestId('game-row').filter({ hasText: 'opponent1' })
  const beRow = page.getByTestId('game-row').filter({ hasText: 'opponent2' })
  await expect(feRow.getByTestId('review-provenance')).toBeVisible()
  await expect(beRow.getByTestId('review-provenance')).toHaveCount(0)
})

test('AppShell header brand link navigates to home', async ({ page }) => {
  const list = new GameListPage(page)
  await list.gotoGames('rookiefan')
  await page.getByRole('link', { name: '♟ Analyzer' }).click()
  await expect(page).toHaveURL('/')
})
