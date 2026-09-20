/* Screenshot harness for reviewing the review-board layout at a phone viewport.
 *
 * Not part of the e2e suite — it asserts nothing, it just renders the real app
 * against the mocked backend and writes PNGs. Lives outside ./specs and runs
 * off its own config so `yarn e2e` never picks it up:
 *
 *   yarn shots                              # -> e2e/shot-out/shot-*.png
 *   SHOT_PREFIX=before yarn shots           # stash a CSS change, shoot "before"
 *   SHOT_W=844 SHOT_H=390 yarn shots        # landscape
 *   SHOT_OUT=/tmp/somewhere yarn shots
 *
 * Before/after workflow: shoot with SHOT_PREFIX=before, apply the CSS change,
 * shoot with SHOT_PREFIX=after, then compare the pairs.
 */
import { test } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { GameViewerPage } from '../pages/GameViewerPage'

const OUT = process.env.SHOT_OUT ?? 'shot-out'
const PREFIX = process.env.SHOT_PREFIX ?? 'shot'
const WIDTH = Number(process.env.SHOT_W ?? 390)
const HEIGHT = Number(process.env.SHOT_H ?? 667)

const USER = 'rookiefan'
const GAME_ID = '123456789'

test.use({ viewport: { width: WIDTH, height: HEIGHT } })

test('shot review board', async ({ page }) => {
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` })
  // The panel — not the window — is the scroll container (the AppShell outlet).
  const scrollTo = (y: number) =>
    page.evaluate((to) => document.querySelector('[class*="outlet"]')?.scrollTo(0, to), y)

  await mockBackend(page)
  const viewer = new GameViewerPage(page)
  await viewer.goto(USER, GAME_ID)

  // Summary screen — is the accuracy scoreboard reachable without scrolling?
  await page.getByText('95.0').first().waitFor({ timeout: 15000 })
  await shot('01-summary')

  // Walkthrough with the board in view. The walkthrough auto-scrolls to the
  // active move, so force the top: this is the state where the nav controls
  // used to fall below the fold.
  await page.getByRole('button', { name: /start review/i }).click()
  await viewer.board().waitFor()
  await page.waitForTimeout(400)
  await scrollTo(0)
  await page.waitForTimeout(300)
  await shot('02-walk-top')

  // Mid-scroll: board leaving, tabs pinned top, nav pinned bottom, list between.
  await scrollTo(150)
  await page.waitForTimeout(300)
  await shot('03-walk-mid')

  // Bottom: board fully gone, tabs still pinned.
  await scrollTo(900)
  await page.waitForTimeout(300)
  await shot('04-walk-deep')
})
