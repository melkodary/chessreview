import { type Page } from '@playwright/test'

export class GameListPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/')
  }

  async enterUsername(name: string) {
    await this.page.getByPlaceholder('Username').fill(name)
  }

  async submit() {
    await this.page.getByRole('button', { name: 'Load Games' }).click()
  }

  // Source is explicit: without it the app falls back to the build's default
  // tab, which differs between the public and the lab build.
  async gotoGames(username: string) {
    await this.page.goto(`/${encodeURIComponent(username)}/games?source=lichess`)
  }

  rows() {
    return this.page.getByTestId('game-row')
  }

  rowAt(i: number) {
    return this.rows().nth(i)
  }

  async openDatePicker() {
    await this.page.getByRole('button', { name: 'Latest ▾' }).click()
  }

  datePicker() {
    return this.page.locator('#game-date-picker')
  }

  dateInput() {
    return this.page.getByLabel('Show games through date')
  }

  async selectBefore(date: string) {
    await this.openDatePicker()
    await this.dateInput().fill(date)
  }

  loadMore() {
    return this.page.getByRole('button', { name: 'Load more' })
  }
}
