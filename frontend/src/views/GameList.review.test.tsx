import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GameList from './GameList'
import type { Game } from '../api/types'
import type { ReviewInboxItem } from '../api/analyzer'

const game: Game = {
  source: 'lichess', id: '42',
  white: { username: 'alice', result: 'win', rating: 1500 },
  black: { username: 'bob', result: 'loss', rating: 1480 },
  pgn: '', endTime: 0, url: '',
}

const dateProps = {
  todayKey: '2026-09-13',
  onRetry: vi.fn(),
  onBeforeChange: vi.fn(),
}

function job(
  status: ReviewInboxItem['status'], accuracy = 91,
  engineSource: ReviewInboxItem['engineSource'] = 'backend',
  counts: ReviewInboxItem['counts'] = null,
): ReviewInboxItem {
  return {
    id: 'j', source: 'lichess', status,
    white: 'alice', black: 'bob', reviewed: 2, totalPlies: 2,
    userId: 'alice', gameId: '42', accuracy, counts,
    createdAt: new Date().toISOString(), finishedAt: null,
    depth: 18, multipv: 2, engine: null, engineSource,
  }
}

function renderList(
  reviewFor: (g: Game) => ReviewInboxItem | undefined,
  onQueueReview: (g: Game) => void,
) {
  return render(
    <MemoryRouter>
      <GameList
        username="alice"
        games={[game]}
        loading={false}
        error=""
        {...dateProps}
        canLoadMore={false}
        onLoadMore={vi.fn()}
        onSelect={vi.fn()}
        reviewFor={reviewFor}
        onQueueReview={onQueueReview}
      />
    </MemoryRouter>,
  )
}

describe('GameList review button', () => {
  it('groups consecutive games under date headings', () => {
    const sameDay = new Date(2020, 5, 2, 12).getTime() / 1000
    const earlier = new Date(2020, 5, 1, 12).getTime() / 1000
    const games = [
      { ...game, id: '1', endTime: sameDay },
      { ...game, id: '2', endTime: sameDay },
      { ...game, id: '3', endTime: earlier },
    ]
    const { getAllByRole } = render(
      <MemoryRouter>
        <GameList
          username="alice"
          games={games}
          loading={false}
          error=""
          {...dateProps}
          canLoadMore={false}
          onLoadMore={vi.fn()}
          onSelect={vi.fn()}
          reviewFor={() => undefined}
          onQueueReview={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      new Date(sameDay * 1000).toLocaleDateString(),
      new Date(earlier * 1000).toLocaleDateString(),
    ])
  })

  it('shows "Review" and calls onQueueReview when no job exists', () => {
    const onQueue = vi.fn()
    const { getByTestId } = renderList(() => undefined, onQueue)
    const btn = getByTestId('review-btn')
    expect(btn.textContent).toBe('Review')
    fireEvent.click(btn)
    expect(onQueue).toHaveBeenCalledWith(game)
  })

  it('Review button does not trigger row-open (stopPropagation)', () => {
    const onSelect = vi.fn()
    const onQueue = vi.fn()
    const { getByTestId, getAllByTestId } = render(
      <MemoryRouter>
        <GameList
          username="alice"
          games={[game]}
          loading={false}
          error=""
          {...dateProps}
          canLoadMore={false}
          onLoadMore={vi.fn()}
          onSelect={onSelect}
          reviewFor={() => undefined}
          onQueueReview={onQueue}
        />
      </MemoryRouter>,
    )
    fireEvent.click(getByTestId('review-btn'))
    expect(onSelect).not.toHaveBeenCalled()
    // Clicking the row itself still works
    fireEvent.click(getAllByTestId('game-row')[0])
    expect(onSelect).toHaveBeenCalledWith(game)
  })

  it('shows done accuracy badge for a done job', () => {
    const { getByTestId } = renderList(() => job('done', 88), vi.fn())
    const btn = getByTestId('review-btn')
    expect(btn.textContent).toContain('88%')
  })

  it('shows an icon badge named "Browser engine" for a frontend-sourced done job', () => {
    const { getByTestId, getByRole } = renderList(() => job('done', 88, 'frontend'), vi.fn())
    expect(getByTestId('review-provenance')).toBeInTheDocument()
    expect(getByRole('img', { name: 'Browser engine' })).toBe(getByTestId('review-provenance'))
  })

  it('renders up to three priority highlights from the player counts', () => {
    const counts = { book: 4, best: 10, good: 3, inaccuracy: 2, mistake: 0, blunder: 1 }
    const { getAllByTestId } = renderList(() => job('done', 88, 'backend', counts), vi.fn())
    const blocks = getAllByTestId('review-highlight')
    expect(blocks.map((b) => b.dataset.classification)).toEqual(['blunder', 'inaccuracy', 'best'])
    expect(blocks[0].textContent).toBe('1Blunder')
  })

  it('renders fewer highlights when fewer classifications occurred', () => {
    const { getAllByTestId } = renderList(() => job('done', 88, 'backend', { brilliant: 1 }), vi.fn())
    expect(getAllByTestId('review-highlight')).toHaveLength(1)
  })

  it('marks a row gold only when the player played a brilliant move', () => {
    const gold = renderList(() => job('done', 88, 'backend', { brilliant: 1, best: 3 }), vi.fn())
    expect(gold.getByTestId('game-row').className).toMatch(/rowBrilliant/)
    const plain = renderList(() => job('done', 88, 'backend', { best: 3 }), vi.fn())
    expect(plain.getAllByTestId('game-row').at(-1)!.className).not.toMatch(/rowBrilliant/)
  })

  it('renders no highlight line when counts are absent', () => {
    const { queryByTestId } = renderList(() => job('done', 88), vi.fn())
    expect(queryByTestId('review-highlights')).toBeNull()
  })

  it('shows no provenance marker for a backend-sourced done job', () => {
    const { queryByTestId } = renderList(() => job('done', 88, 'backend'), vi.fn())
    expect(queryByTestId('review-provenance')).toBeNull()
  })

  it('shows running status with progress for a running job', () => {
    const running: ReviewInboxItem = { ...job('running'), reviewed: 1, totalPlies: 4 }
    const { getByTestId } = renderList(() => running, vi.fn())
    expect(getByTestId('review-btn').textContent).toContain('1/4')
  })

  it('shows "Failed — retry" for an error job', () => {
    const onQueue = vi.fn()
    const { getByTestId } = renderList(() => job('error'), onQueue)
    const btn = getByTestId('review-btn')
    expect(btn.textContent).toContain('Failed')
    fireEvent.click(btn)
    expect(onQueue).toHaveBeenCalled()
  })
})
