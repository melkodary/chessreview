import { type Page } from '@playwright/test'

export class GameViewerPage {
  constructor(private page: Page) {}

  async goto(userId: string, gameId: string) {
    await this.page.goto(`/${encodeURIComponent(userId)}/games/${encodeURIComponent(gameId)}/review?source=lichess`)
  }

  board() {
    return this.page.getByTestId('board')
  }

  moveList() {
    return this.page.getByTestId('move-list')
  }

  nextMove() {
    return this.page.keyboard.press('ArrowRight')
  }

  square(sq: string) {
    return this.board().locator(`[data-square="${sq}"]`)
  }

  // Tap-to-move: click the source square, then the target (deterministic in
  // Playwright, unlike a drag). Same entry gesture the Review board now accepts.
  async tapMove(from: string, to: string) {
    await this.square(from).click()
    await this.square(to).click()
  }
}
