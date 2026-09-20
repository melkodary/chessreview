import { test, expect } from '@playwright/test'
import { mockBackend } from '../mocks/backend'
import { AnalyzeViewerPage } from '../pages/AnalyzeViewerPage'

const USER = 'rookiefan'
const GAME_ID = '123456789'

test.beforeEach(async ({ page }) => {
  await mockBackend(page)
})

// Arrow geometry/colors are unit-tested (reviewArrows); this just proves the
// streamed best lines render as board arrows with valid from-to square pairs.
test('best-line arrows render on the board after streaming', async ({ page }) => {
  const viewer = new AnalyzeViewerPage(page)
  await viewer.goto(USER, GAME_ID)
  await expect(page.getByText('No analysis yet.')).toBeVisible()
  await viewer.nextMove()

  await expect(viewer.arrows()).toHaveCount(3, { timeout: 15000 })

  const attrs = await viewer.arrows().evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-arrow')),
  )
  for (const attr of attrs) {
    expect(attr).toMatch(/^[a-h][1-8]-[a-h][1-8]$/)
  }
})
