import { Chess } from 'chess.js'
import type { AnalysisLine } from '../api/analyzer'

interface ParsedInfo {
  depth: number
  multipv: number
  line: AnalysisLine
}

const MATE_SENTINEL = 99.99
const DEFAULT_MAX_PV = 12

/** Pull the token following `key` from a whitespace-split UCI info line. */
function token(parts: string[], key: string): string | undefined {
  const i = parts.indexOf(key)
  return i >= 0 ? parts[i + 1] : undefined
}

/** Replay UCI long-algebraic pv moves from `fen`, returning SAN, truncating at
 *  the first illegal move and capping at `maxPv` plies. */
function pvToSan(pv: string[], fen: string, maxPv: number): string[] {
  const chess = new Chess(fen)
  const san: string[] = []
  for (const uci of pv) {
    if (san.length >= maxPv) break
    const move = { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }
    try {
      san.push(chess.move(move).san)
    } catch {
      break
    }
  }
  return san
}

/**
 * Parse a single UCI `info` line into a white-relative AnalysisLine, or null
 * if the line carries no usable analysis (no score, no pv, or not an info line).
 *
 * Sign convention matches the backend (`_info_to_line`): UCI scores are
 * side-to-move relative, so cp/mate are negated when Black is to move. Mate sets
 * `mate` (white-relative) and an evaluation of ±99.99 sentinel with matching
 * sign. cp is pawns rounded to 2dp with no clamp (large cp is a real eval, not a
 * sentinel).
 */
export function parseInfo(raw: string, fen: string, maxPv = DEFAULT_MAX_PV): ParsedInfo | null {
  const parts = raw.trim().split(/\s+/)
  if (parts[0] !== 'info') return null

  const scoreIdx = parts.indexOf('score')
  const pvIdx = parts.indexOf('pv')
  if (scoreIdx < 0 || pvIdx < 0) return null

  const pv = parts.slice(pvIdx + 1)
  if (pv.length === 0) return null

  const blackToMove = fen.split(/\s+/)[1] === 'b'
  const sign = blackToMove ? -1 : 1

  const scoreType = parts[scoreIdx + 1]
  const scoreValue = Number(parts[scoreIdx + 2])
  if (!Number.isFinite(scoreValue)) return null

  let evaluation: number
  let mate: number | null = null
  if (scoreType === 'mate') {
    mate = sign * scoreValue
    evaluation = mate > 0 ? MATE_SENTINEL : -MATE_SENTINEL
  } else if (scoreType === 'cp') {
    evaluation = Math.round(sign * scoreValue) / 100
  } else {
    return null
  }

  const moves = pvToSan(pv, fen, maxPv)
  if (moves.length === 0) return null

  const depth = Number(token(parts, 'depth') ?? 0)
  const multipv = Number(token(parts, 'multipv') ?? 1)

  // Retain the raw UCI pv (capped like the SAN moves) so a cached eval can be
  // fed to the backend classifier without a SAN→UCI round-trip.
  const pvUci = pv.slice(0, maxPv)

  return { depth, multipv, line: { moves, evaluation, mate, pvUci } }
}
