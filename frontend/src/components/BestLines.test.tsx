import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BestLines from './BestLines'
import { formatEval } from '../eval'
import type { AnalysisLine } from '../api/analyzer'

const line = (overrides: Partial<AnalysisLine> = {}): AnalysisLine => ({
  moves: ['e4'],
  evaluation: 0,
  mate: null,
  ...overrides,
})

describe('formatEval', () => {
  it('formats positive eval with +', () => {
    expect(formatEval(line({ evaluation: 1.23 }))).toBe('+1.2')
  })

  it('formats negative eval as-is', () => {
    expect(formatEval(line({ evaluation: -0.5 }))).toBe('-0.5')
  })

  it('formats zero without sign', () => {
    expect(formatEval(line({ evaluation: 0 }))).toBe('0.0')
  })

  it('formats positive mate as M<n>', () => {
    expect(formatEval(line({ mate: 3 }))).toBe('M3')
  })

  it('formats negative mate as -M<abs>', () => {
    expect(formatEval(line({ mate: -2 }))).toBe('-M2')
  })

  it('prefers mate over evaluation', () => {
    expect(formatEval(line({ evaluation: 99.99, mate: 5 }))).toBe('M5')
  })
})

describe('BestLines render', () => {
  it('shows loading state', () => {
    render(<BestLines lines={[]} loading={true} error={false} freshCount={0} rows={3} />)
    expect(screen.getByText(/Analyzing/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    render(<BestLines lines={[]} loading={false} error={true} freshCount={0} rows={3} />)
    expect(screen.getByText(/Analysis unavailable/i)).toBeInTheDocument()
  })

  it('shows empty state', () => {
    render(<BestLines lines={[]} loading={false} error={false} freshCount={0} rows={3} />)
    expect(screen.getByText(/No analysis yet/i)).toBeInTheDocument()
  })

  it('renders all provided lines', () => {
    render(
      <BestLines
        lines={[
          line({ moves: ['e4', 'e5'], evaluation: 0.3 }),
          line({ moves: ['d4'], evaluation: -0.1 }),
        ]}
        loading={false}
        error={false}
        freshCount={2}
        rows={3}
      />,
    )
    expect(screen.getByText('+0.3')).toBeInTheDocument()
    expect(screen.getByText('-0.1')).toBeInTheDocument()
    expect(screen.getByText('e4 e5')).toBeInTheDocument()
    expect(screen.getByText('d4')).toBeInTheDocument()
  })
})

describe('BestLines continuity', () => {
  const three = [
    line({ moves: ['e4', 'e5'] }),
    line({ moves: ['d4', 'd5'] }),
    line({ moves: ['Nf3', 'd5'] }),
  ]

  it('dims rows at or past freshCount and leaves the rest alone', () => {
    render(<BestLines lines={three} loading error={false} freshCount={1} rows={3} />)
    const rows = screen.getAllByTestId('best-line')
    expect(rows.map((r) => r.getAttribute('data-stale'))).toEqual([null, 'true', 'true'])
    expect(rows[0].className).not.toContain('stale')
    expect(rows[1].className).toContain('stale')
  })

  it('dims every row when nothing is fresh', () => {
    render(<BestLines lines={three} loading error={false} freshCount={0} rows={3} />)
    expect(screen.getAllByTestId('best-line').map((r) => r.getAttribute('data-stale')))
      .toEqual(['true', 'true', 'true'])
  })

  it('dims no row when everything is fresh', () => {
    render(<BestLines lines={three} loading={false} error={false} freshCount={3} rows={3} />)
    expect(screen.getAllByTestId('best-line').map((r) => r.getAttribute('data-stale')))
      .toEqual([null, null, null])
  })

  it('reserves height from the rows prop via --rows', () => {
    const { container } = render(
      <BestLines lines={[]} loading error={false} freshCount={0} rows={5} />,
    )
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.getPropertyValue('--rows')).toBe('5')
  })

  it('suppresses the status strings while held lines are on screen', () => {
    render(<BestLines lines={three} loading error={false} freshCount={0} rows={3} />)
    expect(screen.queryByText(/Analyzing/i)).toBeNull()
    expect(screen.queryByText(/No analysis yet/i)).toBeNull()
  })
})

describe('BestLines interaction', () => {
  it('clicking a fresh row selects that line', async () => {
    const user = userEvent.setup()
    const candidate = line({ moves: ['e4', 'e5'], pvUci: ['e2e4', 'e7e5'] })
    let selected: AnalysisLine | undefined
    render(
      <BestLines
        lines={[candidate]}
        loading={false}
        error={false}
        freshCount={1}
        rows={1}
        onSelectLine={(chosen) => { selected = chosen }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /e4 e5/i }))
    expect(selected).toBe(candidate)
  })

  it('supports keyboard activation through native button semantics', async () => {
    const user = userEvent.setup()
    const candidate = line({ moves: ['d4'], pvUci: ['d2d4'] })
    let selections = 0
    render(
      <BestLines
        lines={[candidate]}
        loading={false}
        error={false}
        freshCount={1}
        rows={1}
        onSelectLine={() => { selections += 1 }}
      />,
    )

    await user.tab()
    await user.keyboard('{Enter}')
    expect(selections).toBe(1)
  })

  it('disables a fresh row without a first UCI move', async () => {
    const user = userEvent.setup()
    let selections = 0
    render(
      <BestLines
        lines={[line({ moves: ['d4'], pvUci: [] })]}
        loading
        error={false}
        freshCount={1}
        rows={1}
        onSelectLine={() => { selections += 1 }}
      />,
    )
    const row = screen.getByRole('button')
    expect(row).toBeDisabled()

    await user.click(row)
    expect(selections).toBe(0)
  })

  it('disables a stale row', async () => {
    const user = userEvent.setup()
    let selections = 0
    render(
      <BestLines
        lines={[line({ moves: ['e4'], pvUci: ['e2e4'] })]}
        loading
        error={false}
        freshCount={0}
        rows={1}
        onSelectLine={() => { selections += 1 }}
      />,
    )
    const staleRow = screen.getByRole('button')
    expect(staleRow).toBeDisabled()
    await user.click(staleRow)
    expect(selections).toBe(0)
  })
})

describe('BestLines flipped (user plays Black)', () => {
  it('flips badge sign so White-favoring lines read as losing for Black', () => {
    render(
      <BestLines
        lines={[line({ evaluation: 0.3 }), line({ evaluation: -0.1 })]}
        loading={false}
        error={false}
        freshCount={2}
        rows={3}
        flipped
      />,
    )
    const badges = screen.getAllByText(/^[+-]/)
    expect(badges[0]).toHaveAttribute('data-sign', 'negative')
    expect(badges[1]).toHaveAttribute('data-sign', 'positive')
  })

  it('flips mate sign too', () => {
    render(<BestLines lines={[line({ mate: 3 })]} loading={false} error={false} freshCount={1} rows={3} flipped />)
    expect(screen.getByText('M3')).toHaveAttribute('data-sign', 'negative')
  })

  it('not flipped: White-favoring line still reads as winning', () => {
    render(<BestLines lines={[line({ evaluation: 0.3 })]} loading={false} error={false} freshCount={1} rows={3} />)
    expect(screen.getByText('+0.3')).toHaveAttribute('data-sign', 'positive')
  })
})
