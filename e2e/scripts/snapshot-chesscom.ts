/**
 * One-time fixture generator. NOT run in CI or by `yarn e2e`.
 * Usage: npx ts-node e2e/scripts/snapshot-chesscom.ts
 *
 * Fetches a public account's games for the current month, trims to 3, strips
 * noisy fields, anonymises every username (the fixture user is the fictional
 * `rookiefan`; opponents become `opponentN`) and writes
 * e2e/fixtures/chesscom-games.json.
 */

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const USERNAME = process.env.CHESSCOM_USER ?? 'hikaru'
const FIXTURE_USER = 'rookiefan'
const BASE = 'https://api.chess.com/pub'

async function main() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')

  const url = `${BASE}/player/${USERNAME}/games/${year}/${month}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Chess.com returned ${res.status}`)

  const data = (await res.json()) as { games: Record<string, unknown>[] }
  const alias = new Map<string, string>()
  const anon = (name: string) => {
    if (name.toLowerCase() === USERNAME.toLowerCase()) return FIXTURE_USER
    if (!alias.has(name)) alias.set(name, `opponent${alias.size + 1}`)
    return alias.get(name)!
  }
  const player = (p: unknown) => {
    const { username, ...rest } = p as { username: string }
    return { username: anon(username), ...rest }
  }
  const trimmed = data.games.slice(0, 3).map((g) => {
    const white = player(g.white), black = player(g.black)
    let pgn = g.pgn as string
    for (const [real, fake] of [[USERNAME, FIXTURE_USER], ...alias]) {
      pgn = pgn.replaceAll(real, fake)
    }
    return { white, black, end_time: g.end_time, url: g.url, pgn }
  })

  const out = {
    _comment: `Anonymised snapshot of a public Chess.com account, ${year}-${month}. Date: ${new Date().toISOString()}.`,
    games: trimmed,
  }

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/chesscom-games.json')
  writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`Wrote ${trimmed.length} games to ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
