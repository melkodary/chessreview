import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ExplainDisabledError,
  explainMove,
  winChance,
  type Classification,
  type MoveReview,
} from './review'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('review types', () => {
  it('Classification includes book plus the nine scored bands', () => {
    const all: Classification[] = [
      'book',
      'brilliant', 'great', 'best', 'excellent', 'good',
      'inaccuracy', 'mistake', 'blunder', 'miss',
    ]
    expect(all.length).toBe(10)
  })

  it('MoveReview camelCases the BE snake_case payload', () => {
    const m: MoveReview = {
      ply: 1, san: 'e4', fenBefore: '...',
      evalBefore: 0, evalAfterPlayed: 0.2,
      bestMoveSan: 'e4',
      winBefore: 50, winAfterPlayed: 52, winDrop: 0,
      classification: 'best',
      mateBefore: null, mateAfterPlayed: null,
    }
    expect(m.classification).toBe('best')
  })
})

const move: MoveReview = {
  ply: 1,
  san: 'e4',
  fenBefore: 'start fen',
  evalBefore: 0.2,
  evalAfterPlayed: 0.1,
  bestMoveSan: 'e4',
  winBefore: 51.5,
  winAfterPlayed: 50.7,
  winAfterSecond: 42,
  winDrop: 0.8,
  classification: 'best',
  mateBefore: null,
  mateAfterPlayed: null,
}

const backendTrace = {
  label: 'best',
  header: {
    san: 'e4', color: 'white', elo: 1500, k: 0.00425,
    source: 'review row', stored_label: 'best',
    cp: { before_opp: null, before: 20, after_played: 10, after_second: null },
  },
  families: [{
    name: 'forced',
    state: 'no',
    arms: [{
      name: 'forced', state: 'no', blocked_by: 'is_only_legal_move',
      checks: [{
        kind: 'check', name: 'is_only_legal_move', lhs: false,
        op: 'is', rhs: true, state: 'fail', margin: null,
      }],
    }],
  }],
  k_panel: {
    at_1000: 0.003, at_2000: 0.0055, clamp: [0.0025, 0.0065],
    active: 0.00425, clamped: false,
    rows: [{
      feature: 'before', cp: 20, at_1000: 51.5, at_k: 52.1, at_2000: 52.7,
    }],
  },
  band_for: { label: 'best', drop: 0.8 },
  partial: ['after_second'],
}

describe('explainMove', () => {
  it('serializes the stored-review form and camel-cases the trace', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => backendTrace,
    })
    vi.stubGlobal('fetch', fetchMock)

    const trace = await explainMove({
      move,
      whiteElo: 1500,
      blackElo: 1400,
      prevBeforeEval: 0.3,
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/reviews/explain')
    expect(JSON.parse(options.body)).toEqual({
      move: {
        ply: 1,
        san: 'e4',
        fen_before: 'start fen',
        eval_before: 0.2,
        eval_after_played: 0.1,
        best_move_san: 'e4',
        win_before: 51.5,
        win_after_played: 50.7,
        win_after_second: 42,
        win_drop: 0.8,
        classification: 'best',
        mate_before: null,
        mate_after_played: null,
      },
      white_elo: 1500,
      black_elo: 1400,
      prev_before_eval: 0.3,
    })
    expect(trace.header.storedLabel).toBe('best')
    expect(trace.families[0].arms[0].blockedBy).toBe('is_only_legal_move')
    expect(trace.kPanel.rows[0].atK).toBe(52.1)
    expect(trace.bandFor.label).toBe('best')
  })

  it('serializes the position form with optional frontend evaluations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => backendTrace,
    })
    vi.stubGlobal('fetch', fetchMock)

    await explainMove({
      fenBefore: 'start fen',
      uci: 'e2e4',
      depth: 18,
      multipv: 2,
      beforeLines: [
        { uci: 'e2e4', cp: 20 },
        { uci: 'd2d4', cp: 5 },
      ],
      afterEval: { cp: 10 },
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      fen_before: 'start fen',
      uci: 'e2e4',
      depth: 18,
      multipv: 2,
      before_lines: [
        { uci: 'e2e4', cp: 20 },
        { uci: 'd2d4', cp: 5 },
      ],
      after_eval: { cp: 10 },
    })
  })

  it('surfaces a disabled instance distinctly from other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(explainMove({ move })).rejects.toBeInstanceOf(ExplainDisabledError)
  })
})

describe('winChance', () => {
  it('sends exactly one score per point and camel-cases the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { ply: 1, win_after_played: 52.4 },
        { ply: 2, win_after_played: 48.1 },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)

    const points = await winChance(
      [{ ply: 1, cpWhite: 30 }, { ply: 2, mate: -3 }],
      1500,
      1400,
    )

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/win-chance')
    expect(JSON.parse(options.body)).toEqual({
      white_elo: 1500,
      black_elo: 1400,
      points: [{ ply: 1, cp_white: 30 }, { ply: 2, mate: -3 }],
    })
    expect(points).toEqual([
      { ply: 1, winAfterPlayed: 52.4 },
      { ply: 2, winAfterPlayed: 48.1 },
    ])
  })

  it('drops any field the backend adds beyond ply and win, so no badge can ride in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ ply: 1, win_after_played: 50, classification: 'blunder' }],
    }))

    const points = await winChance([{ ply: 1, cpWhite: 0 }], undefined, undefined)
    expect(Object.keys(points[0])).toEqual(['ply', 'winAfterPlayed'])
  })
})
