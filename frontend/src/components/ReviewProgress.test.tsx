import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ReviewProgress from './ReviewProgress'

describe('ReviewProgress', () => {
  it('shows Analyzing… N / total', () => {
    render(<ReviewProgress reviewed={10} total={20} onCancel={() => {}} />)
    expect(screen.getByText(/Analyzing.*10\s*\/\s*20/)).toBeInTheDocument()
  })

  it('the ✕ fires onCancel', () => {
    const onCancel = vi.fn()
    render(<ReviewProgress reviewed={3} total={20} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
