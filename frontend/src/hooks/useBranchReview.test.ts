import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Chess } from 'chess.js'
import { useBranchReview } from './useBranchReview'
import type { MoveReview } from '../api/review'
import type { AnalysisLine } from '../api/analyzer'
import { gradeMove } from '../api/analyzer'
import { ensureEval } from '../engine/ensureEval'
import type { CachedPosition } from '../engine/evalCache'
import { gradeTrace } from '../engine/gradeTrace'
import { PRIORITY } from '../engine/ensureEval'

vi.mock('../api/analyzer', () => ({ gradeMove: vi.fn() }))
vi.mock('../engine/ensureEval', async (orig) => ({
  ...(await orig<typeof import('../engine/ensureEval')>()), ensureEval: vi.fn(),
}))
const mockGrade = vi.mocked(gradeMove)
const mockEnsure = vi.mocked(ensureEval)

function cached(evals: number[]): CachedPosition {
  const lines: AnalysisLine[] = evals.map((e, i) => ({
    moves: [], evaluation: e, mate: null, pvUci: [`m${i}`],
  }))
  return { lines, depth: 18, multipv: lines.length }
}

function node(...sans: string[]) {
  const c = new Chess()
  return sans.map((s) => {
    c.move(s)
    return { fen: c.fen(), san: s }
  })
}

function review(over: Partial<MoveReview>): MoveReview {
  return {
    ply: 0, san: '', fenBefore: '', evalBefore: 0, evalAfterPlayed: 0,
    bestMoveSan: '', winBefore: 50, winAfterPlayed: 50, winDrop: 0,
    classification: 'best', mateBefore: null, mateAfterPlayed: null, ...over,
  }
}

const START = new Chess().fen()

describe('useBranchReview', () => {
  // Default: browser engine unavailable → payload omitted → backend searches
  // (Phase-1 behaviour). The eval-attaching tests override this per case.
  beforeEach(() => {
    vi.useFakeTimers()
    mockGrade.mockReset()
    mockEnsure.mockReset()
    mockEnsure.mockResolvedValue(null)
  })
  afterEach(() => { vi.useRealTimers() })

  const base = {
    forkFen: START, forkPly: 0, gameMoves: [], depth: 18, multipv: 3,
    reviewEngine: 'Stockfish 19', enabled: true,
  }

  it('grades each branch ply and threads the previous ply before-eval as the seed', async () => {
    mockGrade
      .mockResolvedValueOnce(review({ classification: 'inaccuracy', evalBefore: 0.2 }))
      .mockResolvedValueOnce(review({ classification: 'blunder', evalBefore: 0.15 }))

    const branch = node('e4', 'e5')
    const { result } = renderHook(() => useBranchReview({ ...base, branch }))

    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(result.current.map((g) => [g.status, g.review?.classification])).toEqual([
      ['done', 'inaccuracy'],
      ['done', 'blunder'],
    ])
    // Node 0: no seed (fork at start); node 1: seeded with node 0's before-eval.
    expect(mockGrade.mock.calls[0][0]).toMatchObject({
      fenBefore: START, uci: 'e2e4', prevBeforeEval: undefined,
    })
    expect(mockGrade.mock.calls[1][0]).toMatchObject({
      fenBefore: branch[0].fen, uci: 'e7e5', prevBeforeEval: 0.2,
    })
  })

  it("seeds node 0's before_opp from the game review's fork-incoming ply", async () => {
    mockGrade.mockResolvedValue(review({ classification: 'good', evalBefore: 0 }))
    const branch = node('e4') // played from the position after the game's ply 3
    const gameMoves = [review({ ply: 3, evalBefore: 1.4 })]

    renderHook(() => useBranchReview({
      ...base, branch, forkPly: 3, forkFen: START, gameMoves,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockGrade.mock.calls[0][0]).toMatchObject({ prevBeforeEval: 1.4 })
  })

  it('does not grade when disabled and returns an empty list', async () => {
    mockGrade.mockResolvedValue(review({}))
    const branch = node('e4')
    const { result } = renderHook(() => useBranchReview({ ...base, branch, enabled: false }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(result.current).toEqual([])
    expect(mockGrade).not.toHaveBeenCalled()
  })

  // ── Hybrid: attach the browser's evals when available, else fall back to BE ──

  it('attaches the frontend eval payload when both positions are cached deep', async () => {
    mockEnsure.mockResolvedValue(cached([0.1, 0.2])) // before & after resolve, 2 lines
    mockGrade.mockResolvedValue(review({ evalBefore: 0.1 }))
    renderHook(() => useBranchReview({ ...base, branch: node('e4') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    const arg = mockGrade.mock.calls[0][0]
    expect(arg.beforeLines).toHaveLength(2)
    expect(arg.beforeLines?.[0]).toEqual({ uci: 'm0', cp: 10 })
    expect(arg.beforeLines?.[1]).toEqual({ uci: 'm1', cp: 20 })
    expect(arg.afterEval).toEqual({ cp: 10 })
  })

  it('omits the payload (backend searches) when the browser engine is unavailable', async () => {
    mockEnsure.mockResolvedValue(null)
    mockGrade.mockResolvedValue(review({}))
    renderHook(() => useBranchReview({ ...base, branch: node('e4') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    const arg = mockGrade.mock.calls[0][0]
    expect(arg.beforeLines).toBeUndefined()
    expect(arg.afterEval).toBeUndefined()
  })

  it('attaches the payload on a frontend-sourced review (lite label, same version)', async () => {
    mockEnsure.mockResolvedValue(cached([0.1, 0.2]))
    mockGrade.mockResolvedValue(review({ evalBefore: 0.1 }))
    renderHook(() => useBranchReview({
      ...base, branch: node('e4'), reviewEngine: 'Stockfish 19 Lite',
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockGrade.mock.calls[0][0].beforeLines).toHaveLength(2)
  })

  it('omits the payload when review and browser engine identities differ', async () => {
    mockEnsure.mockResolvedValue(cached([0.1, 0.2]))
    mockGrade.mockResolvedValue(review({}))
    renderHook(() => useBranchReview({
      ...base, branch: node('e4'), reviewEngine: 'Candidate 1',
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockGrade.mock.calls[0][0].beforeLines).toBeUndefined()
    expect(mockGrade.mock.calls[0][0].afterEval).toBeUndefined()
  })

  it('omits the payload when the before-position has fewer than two lines', async () => {
    mockEnsure.mockResolvedValue(cached([0.1])) // only one line → no after_second
    mockGrade.mockResolvedValue(review({}))
    renderHook(() => useBranchReview({ ...base, branch: node('e4') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockGrade.mock.calls[0][0].beforeLines).toBeUndefined()
  })

  it('sends before_lines but no after_eval for a terminal (checkmate) branch ply', async () => {
    mockEnsure.mockResolvedValue(cached([0.1, 0.2]))
    mockGrade.mockResolvedValue(review({ evalBefore: 0 }))
    renderHook(() => useBranchReview({ ...base, branch: node('f3', 'e5', 'g4', 'Qh4#') }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    const last = mockGrade.mock.calls.at(-1)![0]
    expect(last.uci).toBe('d8h4')
    expect(last.beforeLines).toHaveLength(2)
    expect(last.afterEval).toBeUndefined() // terminal after-position: BE synthesizes it
  })

  it('traces an attempt aborted by a branch edit, then the re-grade that names the cause', async () => {
    const from = gradeTrace.length
    let release!: (r: MoveReview) => void
    mockGrade
      .mockImplementationOnce(() => new Promise<MoveReview>((r) => { release = r }))
      .mockResolvedValue(review({ classification: 'good' }))
    const [e4, e5] = node('e4', 'e5')
    const { rerender } = renderHook((p: { branch: typeof e4[] }) => useBranchReview({ ...base, ...p }), {
      initialProps: { branch: [e4] },
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    rerender({ branch: [e4, e5] })
    release(review({ classification: 'best' })) // lands after the abort: discarded
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    const mine = gradeTrace.slice(from)
    expect(mine.map((t) => [t.ply, t.outcome, t.pass])).toEqual([
      [0, 'aborted', 1], [0, 'done', 2], [1, 'done', 1],
    ])
    // Engine unavailable → backend searched; the restart names its cause.
    expect(mine[1]).toMatchObject({ causes: ['branch'], backend: { path: 'search' }, classification: 'good' })
    expect(mine[2].causes).toEqual([])
  })

  // ── Newest first: plies are independent given evals ──

  it("grades the newest ply without waiting on an earlier verdict, seeded from the browser's eval", async () => {
    const [e4, e5] = node('e4', 'e5')
    const evalOf: Record<string, number> = { [START]: 0.3, [e4.fen]: 0.25, [e5.fen]: 0.2 }
    mockEnsure.mockImplementation((fen) => Promise.resolve(cached([evalOf[fen], -1])))
    mockGrade
      .mockImplementationOnce(() => new Promise<MoveReview>(() => {})) // ply 0 never answers
      .mockResolvedValue(review({ classification: 'good' }))
    const { result } = renderHook(() => useBranchReview({ ...base, branch: [e4, e5] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    expect(result.current.map((g) => g.status)).toEqual(['pending', 'done'])
    const ply1 = mockGrade.mock.calls.find((c) => c[0].uci === 'e7e5')![0]
    // The seed is the rank-1 score of the position before ply 0 (the fork), as a score.
    expect(ply1).toMatchObject({ prevBefore: { cp: 30 }, afterEval: { cp: 20 } })
    expect(ply1.prevBeforeEval).toBeUndefined()
  })

  it("asks for the newest ply's positions at grade-now priority, older plies at backfill", async () => {
    mockEnsure.mockResolvedValue(cached([0.1, 0.2]))
    mockGrade.mockResolvedValue(review({}))
    const [e4, e5] = node('e4', 'e5')
    renderHook(() => useBranchReview({ ...base, branch: [e4, e5] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })

    const asked = mockEnsure.mock.calls.map((c) => [c[0], c[4]?.priority])
    expect(asked).toContainEqual([e5.fen, PRIORITY.gradeNow]) // newest ply's after
    expect(asked).toContainEqual([e4.fen, PRIORITY.gradeNow]) // newest ply's before
    expect(asked).toContainEqual([e4.fen, PRIORITY.gradeBackfill]) // ply 0's after
    expect(asked).toContainEqual([START, PRIORITY.gradeBackfill]) // ply 0's before
  })
})
