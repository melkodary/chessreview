import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import UsernameInput from './UsernameInput'

// A fixed registry: the real one differs between the public and lab builds.
vi.mock('../api/sources', () => ({
  SOURCES: { lichess: { label: 'Lichess' }, other: { label: 'Other Site' }, pgn: { label: 'PGN' } },
  DEFAULT_SOURCE: 'lichess',
}))

function renderInput(overrides: Partial<ComponentProps<typeof UsernameInput>> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn()
  const onReviewLatest = overrides.onReviewLatest ?? vi.fn()
  const latestLoading = overrides.latestLoading ?? false
  render(
    <MemoryRouter>
      <UsernameInput onSubmit={onSubmit} onReviewLatest={onReviewLatest} latestLoading={latestLoading} />
    </MemoryRouter>,
  )
  return { onSubmit, onReviewLatest }
}

describe('UsernameInput', () => {
  it('submits on Enter with the default source', async () => {
    const { onSubmit } = renderInput()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'lichess')
  })

  it('submits on button click', async () => {
    const { onSubmit } = renderInput()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    await userEvent.click(screen.getByRole('button', { name: /load games/i }))
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'lichess')
  })

  it('passes the selected source on submit', async () => {
    const { onSubmit } = renderInput()
    await userEvent.click(screen.getByRole('button', { name: 'Other Site' }))
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'other')
  })

  it('calls onReviewLatest with trimmed username and current source, not onSubmit', async () => {
    const { onSubmit, onReviewLatest } = renderInput()
    await userEvent.click(screen.getByRole('button', { name: 'Other Site' }))
    await userEvent.type(screen.getByPlaceholderText('Username'), '  mkod11  ')
    await userEvent.click(screen.getByRole('button', { name: /review latest game/i }))
    expect(onReviewLatest).toHaveBeenCalledWith('mkod11', 'other')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders the toggle in registry order with the first tab active', () => {
    renderInput()
    const tabs = within(screen.getByRole('group', { name: 'Game source' })).getAllByRole('button')
    expect(tabs.map((b) => b.textContent)).toEqual(['Lichess', 'Other Site', 'PGN'])
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('Lichess')
  })

  it('swaps the username form for the PGN import on the PGN tab', async () => {
    renderInput()
    await userEvent.click(screen.getByRole('button', { name: 'PGN' }))
    expect(screen.queryByPlaceholderText('Username')).not.toBeInTheDocument()
    expect(screen.getByLabelText('PGN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('disables both buttons when username is empty', () => {
    renderInput()
    expect(screen.getByRole('button', { name: /load games/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /review latest game/i })).toBeDisabled()
  })

  it('disables both buttons and relabels the secondary one while latestLoading', async () => {
    renderInput({ latestLoading: true })
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    expect(screen.getByRole('button', { name: /load games/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled()
  })
})
