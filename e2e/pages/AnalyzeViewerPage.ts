import { expect, type Page } from '@playwright/test'

export class AnalyzeViewerPage {
  constructor(private page: Page) {}

  async goto(userId: string, gameId: string) {
    await this.page.goto(`/${encodeURIComponent(userId)}/games/${encodeURIComponent(gameId)}/analyze?source=lichess`)
  }

  async gotoReview(userId: string, gameId: string) {
    await this.page.goto(`/${encodeURIComponent(userId)}/games/${encodeURIComponent(gameId)}/review?source=lichess`)
  }

  // The tab links live above the outlet, so a flip swaps the panel without
  // remounting the shell (which is what makes branch carry possible at all).
  async openTab(name: 'Review' | 'Analysis') {
    const suffix = name === 'Analysis' ? '/analyze' : '/review'
    const link = this.page.getByRole('link', { name, exact: true })
    await Promise.all([
      this.page.waitForURL((url) => url.pathname.endsWith(suffix)),
      link.click(),
    ])
    await expect(link).toHaveAttribute('aria-current', 'page')
  }

  board() {
    return this.page.getByTestId('board')
  }

  nextMove() {
    return this.page.keyboard.press('ArrowRight')
  }

  depthBadge() {
    return this.page.getByTestId('depth-badge')
  }

  // The badge takes its settled styling on the final frame; CSS Modules are
  // scoped as [name]__[local], so a substring match is stable across builds.
  settledDepthBadge() {
    return this.page.locator('[data-testid="depth-badge"][class*="depthBadgeSettled"]')
  }

  bestLines() {
    return this.page.getByTestId('best-line')
  }

  bestLineMoves() {
    return this.page.getByTestId('best-line-moves')
  }

  playBestLine(index = 0) {
    return this.bestLines().nth(index).click()
  }

  arrows() {
    return this.board().locator('[data-arrow]')
  }

  badge() {
    return this.board().locator('[data-badge]')
  }

  evalBar() {
    return this.page.getByTestId('eval-bar')
  }

  moveList() {
    return this.page.getByTestId('move-list')
  }

  square(sq: string) {
    return this.board().locator(`[data-square="${sq}"]`)
  }

  // Tap-to-move: click the source square, then the target (deterministic in
  // Playwright, unlike a drag).
  async tapMove(from: string, to: string) {
    await this.square(from).click()
    await this.square(to).click()
  }

  exploreBanner() {
    return this.page.getByTestId('explore-banner')
  }

  branchMoves() {
    return this.page.getByTestId('branch-move')
  }

  resetExploration() {
    return this.page.getByRole('button', { name: /reset to game/i }).click()
  }
}
