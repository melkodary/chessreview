import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsernameInput from './UsernameInput'

function renderInput(overrides: Partial<ComponentProps<typeof UsernameInput>> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn()
  const onReviewLatest = overrides.onReviewLatest ?? vi.fn()
  const latestLoading = overrides.latestLoading ?? false
  render(<UsernameInput onSubmit={onSubmit} onReviewLatest={onReviewLatest} latestLoading={latestLoading} />)
  return { onSubmit, onReviewLatest }
}

describe('UsernameInput', () => {
  it('submits on Enter with the default chesscom source', async () => {
    const { onSubmit } = renderInput()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'chesscom')
  })

  it('submits on button click', async () => {
    const { onSubmit } = renderInput()
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11')
    await userEvent.click(screen.getByRole('button', { name: /load games/i }))
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'chesscom')
  })

  it('passes the selected source (lichess) on submit', async () => {
    const { onSubmit } = renderInput()
    await userEvent.click(screen.getByRole('button', { name: /lichess/i }))
    await userEvent.type(screen.getByPlaceholderText('Username'), 'mkod11{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('mkod11', 'lichess')
  })

  it('calls onReviewLatest with trimmed username and current source, not onSubmit', async () => {
    const { onSubmit, onReviewLatest } = renderInput()
    await userEvent.click(screen.getByRole('button', { name: /lichess/i }))
    await userEvent.type(screen.getByPlaceholderText('Username'), '  mkod11  ')
    await userEvent.click(screen.getByRole('button', { name: /review latest game/i }))
    expect(onReviewLatest).toHaveBeenCalledWith('mkod11', 'lichess')
    expect(onSubmit).not.toHaveBeenCalled()
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
