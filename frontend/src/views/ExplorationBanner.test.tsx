import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExplorationBanner from './ExplorationBanner'

describe('ExplorationBanner', () => {
  it('resets the explored variation', () => {
    const onReset = vi.fn()

    render(<ExplorationBanner onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: /reset to game/i }))

    expect(screen.getByTestId('explore-banner')).toBeInTheDocument()
    expect(onReset).toHaveBeenCalledOnce()
  })
})
