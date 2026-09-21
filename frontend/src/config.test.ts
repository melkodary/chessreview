import { afterEach, describe, expect, it, vi } from 'vitest'

// CI passes optional `VITE_*` build-args unconditionally (`vars.X` expands to ''
// when the repo Variable is unset), so the bundle sees present-but-empty vars.
// An empty var must read as *absent* and fall back — otherwise `??` keeps `''`
// and `Number('')` silently becomes 0.
const loadConfig = async () => {
  vi.resetModules()
  return import('./config')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('config env handling', () => {
  it('falls back when a string var is set but empty', async () => {
    vi.stubEnv('VITE_LICHESS_API_BASE', '')
    const { LICHESS_API_BASE } = await loadConfig()
    expect(LICHESS_API_BASE).toBe('https://lichess.org')
  })

  it('falls back when a numeric var is set but empty', async () => {
    vi.stubEnv('VITE_GAMES_PAGE_SIZE', '')
    vi.stubEnv('VITE_DEFAULT_REVIEW_DEPTH', '')
    const { GAMES_PAGE_SIZE, DEFAULT_REVIEW_DEPTH } = await loadConfig()
    expect(GAMES_PAGE_SIZE).toBe(10)
    expect(DEFAULT_REVIEW_DEPTH).toBe(18)
  })

  it('falls back when a boolean var is set but empty', async () => {
    vi.stubEnv('VITE_GRADE_WITH_FRONTEND_ENGINE', '')
    vi.stubEnv('VITE_ENABLE_EXPLAIN', '')
    const { ENABLE_EXPLAIN, GRADE_WITH_FRONTEND_ENGINE } = await loadConfig()
    expect(GRADE_WITH_FRONTEND_ENGINE).toBe(true)
    expect(ENABLE_EXPLAIN).toBe(true)
  })

  it('still honours a var that is genuinely set', async () => {
    vi.stubEnv('VITE_LICHESS_API_BASE', 'https://example.test/pub')
    vi.stubEnv('VITE_GAMES_PAGE_SIZE', '3')
    vi.stubEnv('VITE_GRADE_WITH_FRONTEND_ENGINE', 'false')
    vi.stubEnv('VITE_ENABLE_EXPLAIN', 'false')
    const {
      LICHESS_API_BASE, ENABLE_EXPLAIN, GAMES_PAGE_SIZE, GRADE_WITH_FRONTEND_ENGINE,
    } = await loadConfig()
    expect(LICHESS_API_BASE).toBe('https://example.test/pub')
    expect(GAMES_PAGE_SIZE).toBe(3)
    expect(GRADE_WITH_FRONTEND_ENGINE).toBe(false)
    expect(ENABLE_EXPLAIN).toBe(false)
  })

  it('falls back when a numeric var is set to a non-number', async () => {
    vi.stubEnv('VITE_GAMES_PAGE_SIZE', 'lots')
    const { GAMES_PAGE_SIZE } = await loadConfig()
    expect(GAMES_PAGE_SIZE).toBe(10)
  })
})
