import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EvalBar from './EvalBar'

describe('EvalBar orientation', () => {
  it('white-ahead, not flipped: white sits at the bottom, label at the bottom', () => {
    const { container } = render(<EvalBar evaluation={2} mate={null} />)
    const bar = screen.getByTestId('eval-bar')
    const [top, bottom] = container.querySelectorAll('[data-color]')
    expect(top).toHaveAttribute('data-color', 'black')
    expect(bottom).toHaveAttribute('data-color', 'white')
    expect(bar.textContent).toContain('+2.0')
  })

  it('white-ahead, flipped (user plays Black): white moves to the top', () => {
    const { container } = render(<EvalBar evaluation={2} mate={null} flipped />)
    const [top, bottom] = container.querySelectorAll('[data-color]')
    expect(top).toHaveAttribute('data-color', 'white')
    expect(bottom).toHaveAttribute('data-color', 'black')
  })

  it('black-ahead, flipped: black sits at the bottom, matching the board orientation', () => {
    const { container } = render(<EvalBar evaluation={-2} mate={null} flipped />)
    const [top, bottom] = container.querySelectorAll('[data-color]')
    expect(top).toHaveAttribute('data-color', 'white')
    expect(bottom).toHaveAttribute('data-color', 'black')
  })

  it('a fresh value carries no stale marker', () => {
    const { getByTestId } = render(<EvalBar evaluation={0.5} mate={null} />)
    expect(getByTestId('eval-bar')).not.toHaveAttribute('data-stale')
  })

  it('a held value is marked stale so it renders dimmed, still showing its number', () => {
    const { getByTestId } = render(<EvalBar evaluation={0.5} mate={null} stale />)
    const bar = getByTestId('eval-bar')
    expect(bar).toHaveAttribute('data-stale', 'true')
    // Dimmed, not hidden — the number stays readable.
    expect(bar.textContent).toContain('+0.5')
  })
})
