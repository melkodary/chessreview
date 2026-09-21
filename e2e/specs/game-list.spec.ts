import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameListPage } from '../pages/GameListPage'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

test('enter username → submit → navigates to game list', async ({ page }) => {
  const list = new GameListPage(page)
  await list.goto()
  await page.getByRole('button', { name: 'Lichess' }).click()
  await list.enterUsername('rookiefan')
  await list.submit()
  await expect(page).toHaveURL(/\/rookiefan\/games\?source=lichess/)
})

test('click row navigates to the game viewer', async ({ page }) => {
  const list = new GameListPage(page)
  await list.gotoGames('rookiefan')
  await expect(list.rows()).toHaveCount(3)
  await list.rowAt(0).click()
  await expect(page).toHaveURL(/\/rookiefan\/games\/.*\/analyze/)
})

test('phone layout contains a long username, opponent, and status', async ({ page }) => {
  const username = 'player_with_a_username_that_never_wraps'
  const opponent = 'opponent_with_an_even_longer_name_that_never_wraps_at_all'
  const gameId = 'phone-layout-game'
  await page.setViewportSize({ width: 375, height: 812 })
  await mockBackend(page, {
    games: () => ({ games: [{
      id: gameId,
      white: { username, rating: 1500 },
      black: { username: opponent, rating: 1480 },
      winner: 'white',
      end_time: 1748908800,
      pgn: '',
    }] }),
    reviewQueue: () => [{
      id: 'job-error', source: 'lichess', status: 'error',
      white: username, black: opponent, reviewed: 0, total_plies: 2,
      user_id: username, game_id: gameId, accuracy: null,
      created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      depth: 18, multipv: 3, engine: 'Stockfish 19',
    }],
  })

  const list = new GameListPage(page)
  await list.gotoGames(username)
  const row = list.rowAt(0)
  const control = row.getByTestId('review-btn')
  const name = row.getByText(`vs ${opponent}`)
  const headerUser = page.getByText(username, { exact: true })
  await expect(row).toBeVisible()

  const containment = await page.evaluate(() => {
    const header = document.querySelector('header')!
    const row = document.querySelector('[data-testid="game-row"]')!
    const list = row.parentElement!
    const control = row.querySelector('[data-testid="review-btn"]')!
    const viewport = document.documentElement.clientWidth
    const inside = (inner: Element, outer: Element) => {
      const a = inner.getBoundingClientRect()
      const b = outer.getBoundingClientRect()
      return a.left >= b.left && a.right <= b.right
    }
    return {
      header: header.getBoundingClientRect().right <= viewport
        && [...header.children].every((child) => inside(child, header)),
      row: inside(row, list),
      control: inside(control, row),
    }
  })
  expect(containment).toEqual({ header: true, row: true, control: true })
  await expect(headerUser).toHaveCSS('text-overflow', 'ellipsis')
  expect(await headerUser.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(name).toHaveCSS('text-overflow', 'ellipsis')
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})

test('phone layout contains a reviewed row with three highlights and the provenance badge', async ({ page }) => {
  const username = 'reviewed_player'
  const opponent = 'opponent_with_an_even_longer_name_that_never_wraps_at_all'
  const gameId = '424242'
  await page.setViewportSize({ width: 375, height: 812 })
  await mockBackend(page, {
    games: () => ({ games: [{
      id: gameId,
      white: { username, rating: 1500 },
      black: { username: opponent, rating: 1480 },
      winner: 'white',
      end_time: 1748908800,
      pgn: '',
    }] }),
    reviewQueue: () => [{
      id: 'job-done', source: 'lichess', status: 'done',
      white: username, black: opponent, reviewed: 40, total_plies: 40,
      user_id: username, game_id: gameId, accuracy: 91.5,
      counts: { best: 12, good: 3, inaccuracy: 2, mistake: 1, blunder: 1, book: 4 },
      created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      depth: 18, multipv: 3, engine: 'browser', engine_source: 'frontend',
    }],
  })

  const list = new GameListPage(page)
  await list.gotoGames(username)
  const row = list.rowAt(0)
  await expect(row.getByTestId('review-btn')).toHaveText('✓ 92%')
  await expect(row.getByTestId('review-highlight')).toHaveCount(3)
  await expect(row.getByRole('img', { name: 'Browser engine' })).toBeVisible()

  const contained = await row.evaluate((rowEl) => {
    const list = rowEl.parentElement!
    const inside = (inner: Element, outer: Element) => {
      const a = inner.getBoundingClientRect()
      const b = outer.getBoundingClientRect()
      return a.left >= b.left - 0.5 && a.right <= b.right + 0.5
        && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5
    }
    const parts = rowEl.querySelectorAll(
      '[data-testid="review-btn"], [data-testid="review-highlight"], [data-testid="review-provenance"]',
    )
    return inside(rowEl, list) && [...parts].every((el) => inside(el, rowEl))
      && document.documentElement.scrollWidth <= document.documentElement.clientWidth
  })
  expect(contained).toBe(true)
  const name = row.getByText(`vs ${opponent}`)
  await expect(name).toHaveCSS('text-overflow', 'ellipsis')
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})
