import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NavRow from './NavRow'

const navProps = {
  onFirst: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onLast: vi.fn(),
  atStart: false,
  atEnd: false,
}

describe('NavRow exports', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['FEN', 'branch position w - - 7 21'],
    ['PGN', '[Event "Original"]\n[Site "?"]\n\n1. e4 e5 2. Nf3 *\n'],
  ] as const)('copies the exact %s payload', async (format, value) => {
    render(
      <NavRow
        {...navProps}
        fen={format === 'FEN' ? value : 'start'}
        pgn={format === 'PGN' ? value : '1. e4 *'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: `Copy ${format}` }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(value))
  })

  it('reports clipboard rejection without claiming success', async () => {
    writeText.mockRejectedValue(new Error('permission denied'))
    render(
      <NavRow
        {...navProps}
        fen="position"
        pgn="1. d4 *"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy PGN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t access clipboard')
    expect(screen.queryByText('PGN copied')).toBeNull()
  })

  it('keeps feedback for the latest copy action’s full window', async () => {
    vi.useFakeTimers()
    render(
      <NavRow
        {...navProps}
        fen="position"
        pgn="1. d4 *"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy FEN' }))
    await act(async () => {})
    expect(screen.getByRole('status')).toHaveTextContent('FEN copied')

    act(() => vi.advanceTimersByTime(1_000))
    fireEvent.click(screen.getByRole('button', { name: 'Copy PGN' }))
    await act(async () => {})

    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('status')).toHaveTextContent('PGN copied')

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ignores an older copy result that settles after the latest action', async () => {
    let resolveFen!: () => void
    const slowFen = new Promise<void>((resolve) => { resolveFen = resolve })
    writeText
      .mockImplementationOnce(() => slowFen)
      .mockResolvedValueOnce(undefined)
    render(
      <NavRow
        {...navProps}
        fen="position"
        pgn="1. d4 *"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy FEN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy PGN' }))
    expect(await screen.findByRole('status')).toHaveTextContent('PGN copied')

    await act(async () => resolveFen())

    expect(screen.getByRole('status')).toHaveTextContent('PGN copied')
  })

  it('does not schedule feedback after unmount while a copy is pending', async () => {
    vi.useFakeTimers()
    let resolveCopy!: () => void
    writeText.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveCopy = resolve }),
    )
    const { unmount } = render(
      <NavRow
        {...navProps}
        fen="position"
        pgn="1. d4 *"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy FEN' }))
    unmount()
    await act(async () => resolveCopy())

    expect(vi.getTimerCount()).toBe(0)
  })

  it('adds explain to move tools and fires its handler even at a game-line start', () => {
    const onExplain = vi.fn()
    render(
      <NavRow
        {...navProps}
        atStart
        onExplain={onExplain}
        fen="branch position"
        pgn="1. d4 *"
      />,
    )

    const button = screen.getByRole('button', { name: 'Explain move' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onExplain).toHaveBeenCalledOnce()
    expect(screen.getByRole('toolbar', { name: 'Move tools' })).toContainElement(button)
  })
})
