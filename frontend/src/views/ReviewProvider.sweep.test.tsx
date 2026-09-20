import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { SettingsProvider } from '../settings'
import { ReviewProvider } from './ReviewProvider'
import { useReview } from './reviewContext'
import { sweepGame } from '../engine/sweepGame'
import { putEval, clearEvalCache } from '../engine/evalCache'
import * as analyzer from '../api/analyzer'
import { SWEEP_DEPTH, SWEEP_MULTIPV } from '../config'

vi.mock('../engine/sweepGame', () => ({ sweepGame: vi.fn() }))
vi.mock('../api/review', () => ({ winChance: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/analyzer', () => ({
  createReview: vi.fn().mockResolvedValue({ id: 'job-1', status: 'done', engine: 'Stockfish 19' }),
  getReview: vi.fn().mockImplementation(() => new Promise(() => {})),
  cancelReview: vi.fn().mockResolvedValue(undefined),
  listReviews: vi.fn().mockResolvedValue([]),
}))

const mockSweep = vi.mocked(sweepGame)

// 1. e4 e5 — three positions, no book on the mocked backend.
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
const POSITIONS = [START, AFTER_E4, AFTER_E5].map((fen) => ({ fen, san: null, secondsSpent: null }))

function Probe() {
  const { state, swept, start } = useReview()
  return <button data-testid="probe" data-state={state} data-swept={swept} onClick={start}>go</button>
}

function Wrap({ sweepEnabled }: { sweepEnabled: boolean }) {
  return (
    <SettingsProvider>
      <ReviewProvider
        pgn="1. e4 e5 *" branch={[]} forkFen="" forkPly={0} gradingEnabled={false}
        positions={POSITIONS} sweepEnabled={sweepEnabled}
      >
        <Probe />
      </ReviewProvider>
    </SettingsProvider>
  )
}

describe('ReviewProvider — pass 2 wiring', () => {
  beforeEach(() => { vi.clearAllMocks(); clearEvalCache(); localStorage.clear() })

  it('start() sweeps at the review settings after pass 1, drives the running view, and submits the evals', async () => {
    const line = (uci: string) => ({ moves: [], evaluation: 0.1, mate: null, pvUci: [uci] })
    let finish!: (complete: boolean) => void
    mockSweep
      .mockResolvedValueOnce(true) // pass 1 (SWEEP_DEPTH / SWEEP_MULTIPV)
      .mockImplementationOnce((positions, depth, multipv, _s, onPoints) => new Promise((resolve) => {
        // Pass 2 lands its evals in the shared cache as the real sweep does.
        for (const p of positions) putEval(p.fen, [line('e2e4'), line('d2d4')], depth, multipv)
        onPoints([{ ply: 1, cpWhite: 10 }])
        finish = resolve
      }))
    const { getByTestId } = render(<Wrap sweepEnabled />)
    const probe = getByTestId('probe')

    fireEvent.click(probe)
    await waitFor(() => expect(mockSweep).toHaveBeenCalledTimes(2))
    expect(mockSweep.mock.calls[0].slice(1, 3)).toEqual([SWEEP_DEPTH, SWEEP_MULTIPV])
    expect(mockSweep.mock.calls[1].slice(1, 3)).toEqual([18, 2]) // the request's own settings
    await waitFor(() => expect(probe.getAttribute('data-swept')).toBe('1'))
    expect(probe.getAttribute('data-state')).toBe('running')
    expect(analyzer.createReview).not.toHaveBeenCalled()

    await act(async () => { finish(true) })
    await waitFor(() => expect(analyzer.createReview).toHaveBeenCalledOnce())
    const payload = vi.mocked(analyzer.createReview).mock.calls[0][4]
    expect(payload?.engine).toBe('Stockfish 19 Lite')
    expect(payload?.plies.map((p) => [p.fenBefore, p.fenAfter])).toEqual([
      [START, AFTER_E4], [AFTER_E4, AFTER_E5],
    ])
  })

  it('holds pass 2 while the arbitration says no (Analysis tab / exploring)', async () => {
    const { getByTestId } = render(<Wrap sweepEnabled={false} />)
    fireEvent.click(getByTestId('probe'))
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    expect(getByTestId('probe').getAttribute('data-state')).toBe('running')
    expect(mockSweep).not.toHaveBeenCalled()
    expect(analyzer.createReview).not.toHaveBeenCalled()
  })
})
