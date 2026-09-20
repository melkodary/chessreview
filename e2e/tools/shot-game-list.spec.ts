/* Screenshot harness for the games list — reviewed rows with highlight line and
 * provenance badge, at a phone viewport by default. Same env knobs as
 * shot-mobile.spec.ts (SHOT_OUT / SHOT_PREFIX / SHOT_W / SHOT_H); `yarn shots`.
 */
import { test } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameListPage } from '../pages/GameListPage'
import * as skins from '../../frontend/src/theme/themes'
import type { Theme } from '../../frontend/src/theme/types'

const OUT = process.env.SHOT_OUT ?? 'shot-out'
const PREFIX = process.env.SHOT_PREFIX ?? 'shot'
const WIDTH = Number(process.env.SHOT_W ?? 390)
const HEIGHT = Number(process.env.SHOT_H ?? 667)

// SHOT_MODE=light|dark picks the persisted mode; SHOT_SKIN=terminal|slate|midnight|chesscom
// overlays that skin's palette (the skin is compile-time in the app, so the
// harness paints it in after load to preview per-skin tokens).
const MODE = (process.env.SHOT_MODE ?? 'dark') as 'light' | 'dark'
const SKIN = (process.env.SHOT_SKIN ?? 'terminal') as Theme['name']

const USER = 'rookiefan'

test.use({ viewport: { width: WIDTH, height: HEIGHT } })

test('shot game list', async ({ page }) => {
  const game = (id: number, opponent: string) => ({
    white: { username: USER, result: 'win', rating: 1500 },
    black: { username: opponent, result: 'resigned', rating: 1480 },
    end_time: 1748908800 - id,
    url: `https://www.chess.com/game/live/${id}`,
    pgn: '',
  })
  const job = (id: number, extra: object) => ({
    id: `job-${id}`, source: 'chesscom', status: 'done',
    white: USER, black: 'x', reviewed: 40, total_plies: 40,
    user_id: USER, game_id: String(id), accuracy: 91.5,
    created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    depth: 18, multipv: 3, engine: 'Stockfish 19', engine_source: 'backend',
    ...extra,
  })
  await mockBackend(page, {
    games: () => ({ games: [
      game(1, 'opponent_with_an_even_longer_name_that_never_wraps'),
      game(2, 'magnus'), game(3, 'fabiano'), game(4, 'unreviewed'),
    ] }),
    reviewQueue: () => [
      job(1, { counts: { best: 12, good: 3, inaccuracy: 2, mistake: 1, blunder: 1 }, engine_source: 'frontend', engine: 'browser' }),
      job(2, { counts: { brilliant: 1, great: 2, best: 20 } }),
      job(3, { counts: { blunder: 1 } }),
    ],
  })
  await page.addInitScript((mode) => localStorage.setItem('chessreview-theme', mode), MODE)
  const list = new GameListPage(page)
  await list.gotoGames(USER)
  await list.rows().first().waitFor()
  await page.evaluate((palette) => {
    for (const [k, v] of Object.entries(palette)) document.documentElement.style.setProperty('--' + k, v)
  }, skins[SKIN][MODE])
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${PREFIX}-game-list.png` })
})
