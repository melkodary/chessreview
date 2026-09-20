import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ReviewIntro from './ReviewIntro'

describe('ReviewIntro', () => {
  it('renders Start review button that fires onStart', () => {
    const onStart = vi.fn()
    render(<ReviewIntro onStart={onStart} depth={22} lines={3} />)
    fireEvent.click(screen.getByRole('button', { name: /start review/i }))
    expect(onStart).toHaveBeenCalled()
  })

  it('shows depth and lines chips', () => {
    render(<ReviewIntro onStart={() => {}} depth={22} lines={3} />)
    expect(screen.getByText(/depth 22/i)).toBeInTheDocument()
    expect(screen.getByText(/lines 3/i)).toBeInTheDocument()
  })

  it('error mode: shows the message and a Retry that fires onStart', () => {
    const onStart = vi.fn()
    render(<ReviewIntro onStart={onStart} error="boom" depth={22} lines={3} />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onStart).toHaveBeenCalled()
  })

  // Regression: onClick must not forward the React event into onStart. The
  // consumer passes `start(force?: boolean)`; a leaked SyntheticEvent lands in
  // `force`, gets JSON.stringified by createReview, and throws "Converting
  // circular structure to JSON" (the event chains to `window`).
  it('Start review calls onStart with no arguments (no event leak)', () => {
    const onStart = vi.fn()
    render(<ReviewIntro onStart={onStart} depth={22} lines={3} />)
    fireEvent.click(screen.getByRole('button', { name: /start review/i }))
    expect(onStart).toHaveBeenCalledWith()
  })

  it('Retry calls onStart with no arguments (no event leak)', () => {
    const onStart = vi.fn()
    render(<ReviewIntro onStart={onStart} error="boom" depth={22} lines={3} />)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onStart).toHaveBeenCalledWith()
  })
})
