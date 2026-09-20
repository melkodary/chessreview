import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import type { MoveReview } from '../api/review'
import EvalGraph from './EvalGraph'

function mk(
  ply: number,
  winAfterPlayed: number,
  classification: MoveReview['classification'] = 'best',
  evalAfterPlayed = 0,
  mateAfterPlayed: number | null = null,
): MoveReview {
  return {
    ply, san: 'e4', fenBefore: '',
    evalBefore: 0, evalAfterPlayed,
    bestMoveSan: 'e4',
    winBefore: 50, winAfterPlayed, winDrop: 0,
    classification,
    mateBefore: null, mateAfterPlayed,
  }
}

describe('EvalGraph', () => {
  it('renders a two-tone area fill and a smoothed curve', () => {
    const moves = [mk(1, 55), mk(2, 45), mk(3, 60)]
    const { container } = render(
      <EvalGraph moves={moves} totalPlies={3} currentPly={2} onJump={() => {}} />
    )
    const area = container.querySelector('[data-testid="eval-area"]')
    const curve = container.querySelector('[data-testid="eval-curve"]')
    expect(area?.getAttribute('d')).toContain('Z') // closed fill
    expect(curve?.getAttribute('d')).toContain('C') // smoothed
  })

  it('draws the cursor at the current ply (right edge at the last ply)', () => {
    const moves = [mk(1, 50), mk(2, 50), mk(3, 50), mk(4, 50)]
    const { container } = render(
      <EvalGraph moves={moves} totalPlies={4} currentPly={4} onJump={() => {}} />
    )
    const cursor = container.querySelector('[data-testid="eval-cursor"]')!
    expect(Number(cursor.getAttribute('x1'))).toBeCloseTo(100)
  })

  it('shows a signed eval tooltip on hover', () => {
    // jsdom rects are 0-wide, so the hover resolves to the last move.
    const moves = [mk(1, 50, 'best', 0.2), mk(2, 50, 'best', 5.4)]
    const { container, getByText } = render(
      <EvalGraph moves={moves} totalPlies={2} currentPly={0} onJump={() => {}} />
    )
    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: 50, clientY: 5 })
    expect(getByText('+5.40')).toBeInTheDocument()
  })

  it('shows M# instead of the sentinel eval on a mate move', () => {
    const moves = [mk(1, 50, 'best', 0.2), mk(2, 50, 'best', -99.99, 3)]
    const { container, getByText } = render(
      <EvalGraph moves={moves} totalPlies={2} currentPly={0} onJump={() => {}} />
    )
    const svg = container.querySelector('svg')!
    fireEvent.mouseMove(svg, { clientX: 50, clientY: 5 })
    expect(getByText('M3')).toBeInTheDocument()
  })

  it('draws no provisional layer and the same solid curve when given none', () => {
    const moves = [mk(1, 55), mk(2, 45), mk(3, 60)]
    const bare = render(
      <EvalGraph moves={moves} totalPlies={3} currentPly={2} onJump={() => {}} />
    ).container.innerHTML
    const empty = render(
      <EvalGraph moves={moves} totalPlies={3} currentPly={2} onJump={() => {}} provisional={[]} />
    ).container.innerHTML
    expect(empty).toBe(bare)
    expect(bare).not.toContain('eval-curve-provisional')
  })

  it('lets an authoritative move win the ply an estimate also covers', () => {
    const moves = [mk(1, 90)] // whitePov 90 → y = 3 of 30
    const { container } = render(
      <EvalGraph
        moves={moves}
        totalPlies={2}
        currentPly={1}
        onJump={() => {}}
        provisional={[{ ply: 1, winAfterPlayed: 10 }, { ply: 2, winAfterPlayed: 20 }]}
      />
    )
    // Ply 1 is drawn from the review row (y=3), not the estimate (y=27).
    expect(container.querySelector('[data-testid="eval-curve"]')?.getAttribute('d'))
      .toBe('M 0,3')
    // The merged layer keeps ply 1 authoritative and extends to ply 2, whose
    // estimate is Black's 20 → 80 from White's side → y = 6.
    expect(container.querySelector('[data-testid="eval-curve-provisional"]')?.getAttribute('d'))
      .toBe('M 0,3 C 16.67,3.5 83.33,5.5 100,6')
  })

  it('suppresses the eval readout on an estimated point', () => {
    // jsdom rects are 0-wide, so the hover resolves to the last (estimated) point.
    const { container, queryByText } = render(
      <EvalGraph
        moves={[mk(1, 50, 'best', 0.2)]}
        totalPlies={2}
        currentPly={1}
        onJump={() => {}}
        provisional={[{ ply: 2, winAfterPlayed: 44 }]}
      />
    )
    fireEvent.mouseMove(container.querySelector('svg')!, { clientX: 50, clientY: 5 })
    expect(container.querySelector('.marker, [class*="marker"]')).toBeInTheDocument()
    expect(queryByText('+0.20')).not.toBeInTheDocument()
  })

  it('jumps to the ply of an estimated point, not its array index', () => {
    const onJump = vi.fn()
    const { container } = render(
      <EvalGraph
        moves={[]}
        totalPlies={4}
        currentPly={0}
        onJump={onJump}
        provisional={[{ ply: 3, winAfterPlayed: 50 }, { ply: 4, winAfterPlayed: 50 }]}
      />
    )
    fireEvent.click(container.querySelector('svg')!, { clientX: 50, clientY: 5 })
    expect(onJump).toHaveBeenCalledWith(4)
  })

  it('clicking calls onJump', () => {
    const moves = [mk(1, 50), mk(2, 50), mk(3, 50), mk(4, 50)]
    const onJump = vi.fn()
    const { container } = render(
      <EvalGraph moves={moves} totalPlies={4} currentPly={0} onJump={onJump} />
    )
    const svg = container.querySelector('svg')!
    fireEvent.click(svg, { clientX: 10, clientY: 5 })
    expect(onJump).toHaveBeenCalled()
  })
})
