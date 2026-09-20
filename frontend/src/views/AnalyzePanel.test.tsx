import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { GameShellContext } from './gameShellContext'
import type { MoveReview } from '../api/review'
import type { AnalysisLine } from '../api/analyzer'
import AnalyzePanel from './AnalyzePanel'

// Engine + overlay are out of scope here; stub them.
let streamingArgs: unknown[] = []
type StreamingState = {
  lines: AnalysisLine[]
  displayLines: AnalysisLine[]
  freshCount: number
  currentDepth: number
  loading: boolean
  error: string | null
}
const idleStreaming = (): StreamingState =>
  ({ lines: [], displayLines: [], freshCount: 0, currentDepth: 0, loading: false, error: null })
let streamingState: StreamingState = idleStreaming()
vi.mock('../hooks/useStreamingAnalysis', () => ({
  useStreamingAnalysis: (...args: unknown[]) => {
    streamingArgs = args
    return streamingState
  },
}))
let arrowLines: AnalysisLine[] = []
vi.mock('../hooks/useArrows', () => ({
  useArrows: (_fen: string, lines: AnalysisLine[]) => { arrowLines = lines; return [] },
}))
let lastOverlay: unknown
vi.mock('./useBoardOverlay', () => ({ useBoardOverlay: (o: unknown) => { lastOverlay = o } }))
vi.mock('../settingsContext', () => ({
  useSettings: () => ({
    analysisTimeMs: 20_000,
    analysisLines: 2,
    reviewDepth: 18,
    reviewMultiPv: 2,
  }),
}))

const ctx: GameShellContext = {
  game: {
    source: 'chesscom',
    id: '1',
    white: { username: 'alice', rating: 1500, result: 'win' },
    black: { username: 'bob', rating: 1400, result: 'loss' },
    pgn: '1. e4 e5 *',
    endTime: 0,
    url: '',
  },
  username: 'alice',
  positions: [
    { fen: 'start', san: null },
    { fen: 'a', san: 'e4' },
    { fen: 'b', san: 'e5' },
  ],
  moveIndex: 2,
  goTo: vi.fn(),
  currentFen: 'b',
  isUserWhite: true,
  setBoardOverlay: vi.fn(),
  setAnalysisStatus: vi.fn(),
  exploring: false,
  branch: [],
  branchIndex: 0,
  resetExploration: vi.fn(),
  selectBranch: vi.fn(),
  branchBack: vi.fn(),
  branchForward: vi.fn(),
  playExplorationUci: vi.fn(),
}

let mockCtx: GameShellContext
vi.mock('./gameShellContext', () => ({
  useGameShell: () => mockCtx,
}))

let mockReviewMoves: MoveReview[] = []
vi.mock('./reviewContext', () => ({
  useReview: () => ({ moves: mockReviewMoves }),
}))

function move(partial: Partial<MoveReview> & { ply: number; classification: MoveReview['classification'] }): MoveReview {
  return {
    san: 'e5', fenBefore: 'b',
    evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: 'e5', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    mateBefore: null, mateAfterPlayed: null,
    ...partial,
  }
}

function setup(overrides: Partial<GameShellContext> = {}, reviewMoves: MoveReview[] = []) {
  mockCtx = { ...ctx, ...overrides }
  mockReviewMoves = reviewMoves
  return render(<AnalyzePanel />)
}

describe('AnalyzePanel tab status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamingState = idleStreaming()
  })

  it('reports running depth to the shell and clears it on unmount', () => {
    const setAnalysisStatus = vi.fn()
    streamingState = { ...idleStreaming(), currentDepth: 12, loading: true }
    const { unmount } = setup({ setAnalysisStatus })

    expect(setAnalysisStatus).toHaveBeenCalledWith({ depth: 12, settled: false })
    unmount()
    expect(setAnalysisStatus).toHaveBeenLastCalledWith(null)
  })

  it('reports settled depth and hides the status on error', () => {
    const setAnalysisStatus = vi.fn()
    streamingState = { ...idleStreaming(), currentDepth: 31 }
    const { rerender } = setup({ setAnalysisStatus })
    expect(setAnalysisStatus).toHaveBeenCalledWith({ depth: 31, settled: true })

    streamingState = { ...idleStreaming(), currentDepth: 31, error: 'failed' }
    rerender(<AnalyzePanel />)
    expect(setAnalysisStatus).toHaveBeenLastCalledWith(null)
  })
})

describe('AnalyzePanel analysis start gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamingArgs = []
    streamingState = idleStreaming()
  })

  it('disables analysis at the untouched game start', () => {
    setup({ moveIndex: 0, currentFen: 'start', exploring: false, branchIndex: 0 })
    expect(streamingArgs[5]).toBe(false)
  })

  it('enables analysis after a game or branch move', () => {
    const { unmount } = setup({ moveIndex: 1, currentFen: 'a', branchIndex: 0 })
    expect(streamingArgs[5]).toBe(true)
    unmount()

    setup({
      moveIndex: 0,
      currentFen: 'x',
      exploring: true,
      branch: [{ fen: 'x', san: 'e4' }],
      branchIndex: 1,
    })
    expect(streamingArgs[5]).toBe(true)
  })
})

// fenBefore for ply 2 (…e5, positions[2]) — the position after 1. e4.
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

describe('AnalyzePanel review annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamingState = idleStreaming()
  })

  it('drops the badge while exploring but keeps the move-list icons', () => {
    const reviews = [move({ ply: 2, san: 'e5', fenBefore: AFTER_E4, classification: 'blunder' })]
    const { container } = setup({ exploring: true, branch: [{ fen: 'x', san: 'c5' }] }, reviews)
    expect(lastOverlay).toMatchObject({ badge: undefined })
    expect(container.querySelectorAll('[data-classification="blunder"]')).toHaveLength(1)
  })

})

describe('AnalyzePanel display channel', () => {
  const pv = (moves: string[], evaluation: number): AnalysisLine =>
    ({ moves, evaluation, mate: null })

  beforeEach(() => {
    vi.clearAllMocks()
    arrowLines = []
    streamingState = idleStreaming()
  })

  it('gives the arrows only the fresh prefix of the display lines', () => {
    const fresh = pv(['e5', 'Nf3'], 0.3)
    streamingState = {
      ...idleStreaming(),
      displayLines: [fresh, pv(['d4', 'd5'], 0.1)],
      freshCount: 1,
      loading: true,
    }
    setup()
    expect(arrowLines).toEqual([fresh])
  })

  it('holds the eval bar at the last known value across a stale gap', () => {
    streamingState = {
      ...idleStreaming(),
      lines: [pv(['e5'], 1.4)],
      displayLines: [pv(['e5'], 1.4)],
      freshCount: 1,
    }
    const { rerender } = setup()
    expect(lastOverlay).toMatchObject({ evalBar: { evaluation: 1.4, stale: false } })

    // Position changed, nothing carried: the number stays, marked stale.
    streamingState = {
      ...idleStreaming(),
      displayLines: [pv(['e5'], 1.4)],
      freshCount: 0,
      loading: true,
    }
    rerender(<AnalyzePanel />)
    expect(lastOverlay).toMatchObject({ evalBar: { evaluation: 1.4, stale: true } })
  })

})

describe('AnalyzePanel line selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamingState = idleStreaming()
  })

  it('plays only the selected line first UCI move', () => {
    let played: string | undefined
    streamingState = {
      ...idleStreaming(),
      displayLines: [{
        moves: ['e4', 'e5'],
        evaluation: 0.2,
        mate: null,
        pvUci: ['e2e4', 'e7e5'],
      }],
      freshCount: 1,
    }
    const { getByRole } = setup({
      playExplorationUci: (uci) => { played = uci },
    })

    fireEvent.click(getByRole('button', { name: /e4 e5/i }))
    expect(played).toBe('e2e4')
  })
})
