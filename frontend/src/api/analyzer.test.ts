import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cancelReview, createReview, getReview, gradeMove, listReviews } from './analyzer'

describe('getReview', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps a durable full-row snapshot and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'job/7',
        source: 'lichess',
        status: 'done',
        white: 'Alice',
        black: 'Bob',
        reviewed: 1,
        total_plies: 2,
        user_id: 'alice',
        game_id: 'game-7',
        accuracy: 95.4,
        counts: { best: 1 },
        created_at: '2026-07-31T12:00:00Z',
        finished_at: '2026-07-31T12:00:02Z',
        depth: 18,
        multipv: 2,
        engine: 'Stockfish 19',
        engine_source: 'frontend',
        moves: [{
          ply: 1, san: 'e4', fen_before: 'start',
          eval_before: 0.2, eval_after_played: 0.3,
          best_move_san: 'e4',
          win_before: 50, win_after_played: 51, win_after_second: 42, win_drop: 0,
          classification: 'best',
          mate_before: null, mate_after_played: null,
        }],
        summary: {
          white: {
            accuracy: 95.4, game_rating: 1600,
            counts: { best: 1 }, biggest_blunder_ply: null,
          },
          black: {
            accuracy: 91.2, game_rating: 1500,
            counts: {}, biggest_blunder_ply: null,
          },
          game_rating_algorithm: 'formula-v1',
          key_moments: [],
          opening: { eco: 'C20', name: "King's Pawn Game", until_ply: 2 },
        },
        error: null,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const review = await getReview('job/7', signal)

    expect(review).toEqual({
      id: 'job/7',
      source: 'lichess',
      status: 'done',
      white: 'Alice',
      black: 'Bob',
      reviewed: 1,
      totalPlies: 2,
      userId: 'alice',
      gameId: 'game-7',
      accuracy: 95.4,
      counts: { best: 1 },
      createdAt: '2026-07-31T12:00:00Z',
      finishedAt: '2026-07-31T12:00:02Z',
      depth: 18,
      multipv: 2,
      engine: 'Stockfish 19',
      engineSource: 'frontend',
      moves: [{
        ply: 1, san: 'e4', fenBefore: 'start',
        evalBefore: 0.2, evalAfterPlayed: 0.3,
        bestMoveSan: 'e4',
        winBefore: 50, winAfterPlayed: 51, winAfterSecond: 42, winDrop: 0,
        classification: 'best',
        mateBefore: null, mateAfterPlayed: null,
      }],
      summary: {
        white: {
          accuracy: 95.4, gameRating: 1600,
          counts: { best: 1 }, biggestBlunderPly: null,
        },
        black: {
          accuracy: 91.2, gameRating: 1500,
          counts: {}, biggestBlunderPly: null,
        },
        gameRatingAlgorithm: 'formula-v1',
        keyMoments: [],
        opening: { eco: 'C20', name: "King's Pawn Game", untilPly: 2 },
      },
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/reviews/job%2F7'),
      { signal },
    )
  })

  it('rejects a missing snapshot through the review error path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(
      getReview('missing', new AbortController().signal),
    ).rejects.toThrow('Review failed')
  })
})

describe('listReviews', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps inbox counts and keeps null as null', async () => {
    const row = {
      id: 'j', source: 'lichess', status: 'done', white: 'Alice', black: 'Bob',
      reviewed: 2, total_plies: 2, user_id: 'alice', game_id: '1', accuracy: 90,
      created_at: '2026-07-31T12:00:00Z', finished_at: null,
      depth: 18, multipv: 2, engine: null, engine_source: 'backend',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ ...row, counts: { blunder: 2, best: 5 } }, { ...row, counts: null }],
    }))

    const [withCounts, without] = await listReviews()
    expect(withCounts.counts).toEqual({ blunder: 2, best: 5 })
    expect(without.counts).toBeNull()
  })
})

describe('createReview / cancelReview', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('POSTs a review job and returns the ref', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'job-7', status: 'queued', engine: null }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const ref = await createReview('1. e4 *', 22, 3)

    expect(ref).toEqual({ id: 'job-7', status: 'queued', engine: null })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/reviews')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ pgn: '1. e4 *', depth: 22, multipv: 3 })
  })

  it('sends known player ratings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'job-8', status: 'queued' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createReview('1. e4 *', 22, 3, { whiteElo: 1500, blackElo: 1420 })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({
      pgn: '1. e4 *', depth: 22, multipv: 3,
      white_elo: 1500, black_elo: 1420,
    })
  })

  it('throws when create fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(createReview('1. e4 *', 22, 3)).rejects.toThrow('Review failed')
  })

  it('DELETEs the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await cancelReview('job-9')

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/reviews/job-9')
    expect(opts.method).toBe('DELETE')
  })
})

describe('gradeMove', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends before-line moves and scores', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ply: 1, san: 'e4', fen_before: 'start', eval_before: 0,
        eval_after_played: 0, best_move_san: 'e4', win_before: 50,
        win_after_played: 50, win_drop: 0, classification: 'best',
        mate_before: null, mate_after_played: null,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await gradeMove({
      fenBefore: 'start', uci: 'e2e4', depth: 18, multipv: 2,
      beforeLines: [
        { uci: 'e2e4', cp: 0 },
        { uci: 'd2d4', cp: 5 },
      ],
      afterEval: { cp: 0 },
    })

    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body).before_lines).toEqual([
      { uci: 'e2e4', cp: 0 },
      { uci: 'd2d4', cp: 5 },
    ])
  })
})
