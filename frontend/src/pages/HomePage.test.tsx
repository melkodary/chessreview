import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SettingsProvider } from '../settings'
import HomePage from './HomePage'

const { listRecent } = vi.hoisted(() => ({ listRecent: vi.fn() }))
vi.mock('../api/sources', () => ({
  asSource: (v: string | null) => (v === 'lichess' ? 'lichess' : 'chesscom'),
  getSource: () => ({ listRecent, fetchGame: vi.fn() }),
}))

function renderHome() {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/:userId/games" element={<div>games page</div>} />
          <Route path="/:userId/games/:gameId/review" element={<div>review page</div>} />
        </Routes>
      </MemoryRouter>
    </SettingsProvider>,
  )
}

describe('HomePage — Review Latest Game', () => {
  it('navigates to the review route when a game is found', async () => {
    listRecent.mockReset()
    listRecent.mockResolvedValue([{ id: 'g1' }])
    renderHome()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    await userEvent.click(screen.getByRole('button', { name: /review latest game/i }))
    expect(await screen.findByText('review page')).toBeInTheDocument()
    expect(listRecent).toHaveBeenCalledWith('mkod11', 1)
  })

  it('navigates to the games route when no games are found', async () => {
    listRecent.mockReset()
    listRecent.mockResolvedValue([])
    renderHome()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    await userEvent.click(screen.getByRole('button', { name: /review latest game/i }))
    expect(await screen.findByText('games page')).toBeInTheDocument()
  })

  it('navigates to the games route when listRecent rejects', async () => {
    listRecent.mockReset()
    listRecent.mockRejectedValue(new Error('User not found'))
    renderHome()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    await userEvent.click(screen.getByRole('button', { name: /review latest game/i }))
    expect(await screen.findByText('games page')).toBeInTheDocument()
  })
})
