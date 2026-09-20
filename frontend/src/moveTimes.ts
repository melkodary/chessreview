import { Chess } from 'chess.js'

interface TimeControl {
  base: number | null // starting seconds; null for daily/unlimited ("-", "1/259200")
  increment: number
}

// "180+2" → { base: 180, increment: 2 }; "180" → { base: 180, increment: 0 };
// "-" / "1/259200" / missing → { base: null, increment: 0 }.
function parseTimeControl(tc: string | undefined): TimeControl {
  if (!tc) return { base: null, increment: 0 }
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim())
  if (!m) return { base: null, increment: 0 }
  return { base: Number(m[1]), increment: m[2] ? Number(m[2]) : 0 }
}

// Remaining seconds after each ply, in movetext order, from `%clk h:mm:ss(.t)`.
function parseClocks(pgn: string): number[] {
  const re = /%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/g
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(pgn)) !== null) {
    out.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
  }
  return out
}

// Seconds spent per ply (1..N), aligned to the move order. `null` where a delta
// isn't derivable (e.g. first move of a side under a baseless time control).
// Returns [] when the game has no clocks, or when the clock count doesn't line
// up 1:1 with the moves (partial annotations → don't risk misaligning times).
export function moveTimesSpent(pgn: string): (number | null)[] {
  const remaining = parseClocks(pgn)
  if (remaining.length === 0) return [] // no clocks → feature inert
  const game = new Chess()
  try {
    game.loadPgn(pgn)
  } catch {
    return []
  }
  if (remaining.length !== game.history().length) return [] // count guard
  const { base, increment } = parseTimeControl(game.getHeaders().TimeControl)
  return remaining.map((rem, p) => {
    const prev = p >= 2 ? remaining[p - 2] : base // same player's previous clock, or base
    if (prev == null) return null
    return Math.max(0, prev - rem + increment) // spent = Δclock + increment, clamped
  })
}
