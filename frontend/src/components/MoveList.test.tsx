import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

import type { Classification } from '../api/review'
import MoveList from './MoveList'
import { buildPairs } from './moveList.pairs'

const POSITIONS = [
  { fen: 'start', san: null },
  { fen: 'a',     san: 'e4' },
  { fen: 'b',     san: 'e5' },
  { fen: 'c',     san: 'Nf3' },
]

describe('buildPairs', () => {
  it('returns empty array for zero moves', () => {
    expect(buildPairs(0)).toEqual([])
  })

  it('pairs even move count fully', () => {
    expect(buildPairs(4)).toEqual([
      { moveNum: 1, whiteIdx: 1, blackIdx: 2 },
      { moveNum: 2, whiteIdx: 3, blackIdx: 4 },
    ])
  })

  it('leaves trailing black slot null on odd count', () => {
    expect(buildPairs(3)).toEqual([
      { moveNum: 1, whiteIdx: 1, blackIdx: 2 },
      { moveNum: 2, whiteIdx: 3, blackIdx: null },
    ])
  })

  it('single white-only move', () => {
    expect(buildPairs(1)).toEqual([
      { moveNum: 1, whiteIdx: 1, blackIdx: null },
    ])
  })
})

describe('MoveList with reviews', () => {
  it('renders a classification icon next to each special-classified ply', () => {
    const reviews = new Map<number, Classification>([
      [1, 'blunder'], [2, 'best'], [3, 'inaccuracy'],
    ])
    const { container } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} reviews={reviews} />
    )
    expect(container.querySelectorAll('[data-classification="blunder"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-classification="inaccuracy"]')).toHaveLength(1)
  })

  it('renders no icon for the non-special classifications (book/best/excellent/good)', () => {
    const reviews = new Map<number, Classification>([
      [1, 'book'], [2, 'best'], [3, 'excellent'],
    ])
    const { container } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} reviews={reviews} />
    )
    expect(container.querySelectorAll('[data-classification]')).toHaveLength(0)
    // SAN still renders in every cell — the filter hides the icon, not the move.
    expect(container.querySelectorAll('[data-testid="move-item"]')).toHaveLength(3)
  })

  it('renders no icon for forced (board badge only, per spec)', () => {
    const reviews = new Map<number, Classification>([[1, 'forced']])
    const { container } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} reviews={reviews} />
    )
    expect(container.querySelectorAll('[data-classification]')).toHaveLength(0)
  })

  it('renders no icons when reviews prop is absent', () => {
    const { container } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} />
    )
    expect(container.querySelectorAll('[data-classification]')).toHaveLength(0)
  })
})

describe('MoveList move times', () => {
  const TIMED = [
    { fen: 'start', san: null, secondsSpent: null },
    { fen: 'a',     san: 'e4',  secondsSpent: 8.4 },
    { fen: 'b',     san: 'e5',  secondsSpent: 14 },
    { fen: 'c',     san: 'Nf3', secondsSpent: 83 },
  ]

  it('renders formatted times across the thresholds', () => {
    const { getAllByTestId } = render(
      <MoveList positions={TIMED} currentIndex={0} onSelect={() => {}} />,
    )
    expect(getAllByTestId('move-time').map((t) => t.textContent)).toEqual(['8.4s', '14s', '1:23'])
  })

  it('scales the magnitude bar with think time', () => {
    const { getAllByTestId } = render(
      <MoveList positions={TIMED} currentIndex={0} onSelect={() => {}} />,
    )
    const w = getAllByTestId('time-bar').map((b) => parseFloat((b as HTMLElement).style.width))
    expect(w[0]).toBeLessThan(w[1]) // 8.4s < 14s
    expect(w[1]).toBeLessThan(w[2]) // 14s < 1:23
  })

  it('keeps two slow moves distinguishable instead of clamping both to full', () => {
    // Both well past the old fixed 30s cap: under the old scale both pinned to
    // 100% and read identical. Normalized to the game's own max, they separate.
    const slow = [
      { fen: 'start', san: null, secondsSpent: null },
      { fen: 'a',     san: 'e4',  secondsSpent: 40 },
      { fen: 'b',     san: 'e5',  secondsSpent: 300 },
    ]
    const { getAllByTestId } = render(
      <MoveList positions={slow} currentIndex={0} onSelect={() => {}} />,
    )
    const w = getAllByTestId('time-bar').map((b) => parseFloat((b as HTMLElement).style.width))
    expect(w[0]).toBeLessThan(w[1]) // 40s < 300s, not both 100%
    expect(w[1]).toBe(100) // slowest move of the game fills the bar
  })

  it('sets bar width to the raw percentage of the game max think-time', () => {
    // Pure proportion: no floor, no curve. A 0.1s move in a game whose slowest
    // move is 60s is a near-empty sliver; the 60s move fills the bar.
    const times = [
      { fen: 'start', san: null, secondsSpent: null },
      { fen: 'a',     san: 'e4',  secondsSpent: 0.1 },
      { fen: 'b',     san: 'e5',  secondsSpent: 1.5 },
      { fen: 'c',     san: 'Nf3', secondsSpent: 15 },
      { fen: 'd',     san: 'Nc3', secondsSpent: 60 },
    ]
    const { getAllByTestId } = render(
      <MoveList positions={times} currentIndex={0} onSelect={() => {}} />,
    )
    const w = getAllByTestId('time-bar').map((b) => parseFloat((b as HTMLElement).style.width))
    expect(w[0]).toBeCloseTo(0.1 / 60 * 100, 5) // ~0.17%
    expect(w[1]).toBeCloseTo(1.5 / 60 * 100, 5) // 2.5%
    expect(w[2]).toBeCloseTo(25, 5) // 15s of 60s
    expect(w[3]).toBe(100) // 60s is the game max
  })

  it('tints the bar by side (white vs black ply)', () => {
    const { getAllByTestId } = render(
      <MoveList positions={TIMED} currentIndex={0} onSelect={() => {}} />,
    )
    // plies: 1 e4 (white), 2 e5 (black), 3 Nf3 (white)
    expect(getAllByTestId('time-bar').map((b) => b.getAttribute('data-side')))
      .toEqual(['white', 'black', 'white'])
  })

  it('renders no time cell when secondsSpent is null/absent', () => {
    const { queryAllByTestId } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} />,
    )
    expect(queryAllByTestId('move-time')).toHaveLength(0)
  })
})

describe('MoveList exploration branch', () => {
  // Deviate after 2 half-moves (…e5), explore Bc4 Bc5.
  const branch = [
    { fen: 'x', san: 'Bc4' },
    { fen: 'y', san: 'Bc5' },
  ]

  function renderExploring(branchIndex: number, onSelectBranch = vi.fn(), onSelect = vi.fn()) {
    const utils = render(
      <MoveList
        positions={POSITIONS}
        currentIndex={2}
        onSelect={onSelect}
        branch={branch}
        branchIndex={branchIndex}
        deviationPly={2}
        onSelectBranch={onSelectBranch}
      />,
    )
    return { ...utils, onSelectBranch, onSelect }
  }

  it('renders no branch moves without exploration props', () => {
    const { queryAllByTestId } = render(
      <MoveList positions={POSITIONS} currentIndex={0} onSelect={() => {}} />,
    )
    expect(queryAllByTestId('branch-move')).toHaveLength(0)
  })

  it('renders one cell per branch half-move', () => {
    const { getAllByTestId } = renderExploring(2)
    const moves = getAllByTestId('branch-move')
    expect(moves.map((m) => m.textContent)).toEqual(['Bc4', 'Bc5'])
  })

  it('marks the active branch node', () => {
    const { getAllByTestId } = renderExploring(1)
    const moves = getAllByTestId('branch-move')
    expect(moves[0].getAttribute('data-active')).toBe('true')
    expect(moves[1].getAttribute('data-active')).toBe('false')
  })

  it('clicking a branch move selects that node', () => {
    const { getAllByTestId, onSelectBranch } = renderExploring(2)
    fireEvent.click(getAllByTestId('branch-move')[0])
    expect(onSelectBranch).toHaveBeenCalledWith(1)
  })

  it('clicking a game move calls onSelect (restores the game), not onSelectBranch', () => {
    const { getAllByTestId, onSelect, onSelectBranch } = renderExploring(2)
    fireEvent.click(getAllByTestId('move-item')[2]) // Nf3 (game continuation, posIdx 3)
    expect(onSelect).toHaveBeenCalledWith(3)
    expect(onSelectBranch).not.toHaveBeenCalled()
  })

  it('dims the game continuation after the deviation ply', () => {
    const { getAllByTestId } = renderExploring(2)
    const cells = getAllByTestId('move-item')
    // POSITIONS plies: 1 e4, 2 e5 (deviation), 3 Nf3 (continuation → dimmed)
    expect(cells[2].getAttribute('data-dimmed')).toBe('true') // Nf3, idx 3 is cells[2]
    expect(cells[0].getAttribute('data-dimmed')).toBe('false') // e4, before deviation
  })
})
