import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Dev-server port. Env-overridable so parallel agents working in separate git
// worktrees each get their own server: `reuseExistingServer` keys off the port,
// so a shared one would silently hand worktree B the suite running against
// worktree A's code — a green run against the wrong tree.
const PORT = Number(process.env.E2E_PORT ?? 5173)
const CI = !!process.env.CI
const PRIVATE_SPECS = fileURLToPath(new URL('./specs/private', import.meta.url))

// Analyze specs boot a real multi-threaded WASM engine per page. GitHub's
// runners have 2 vCPUs, so two workers × a 2-thread engine oversubscribes the
// box and the engine emits no frame at all.
const WORKERS = Number(process.env.E2E_WORKERS ?? (CI ? 1 : 2))
// Residual guard, not the fix: a real engine on a shared runner stays somewhat
// non-deterministic. `trace: 'on-first-retry'` below exists for exactly this.
const RETRIES = Number(process.env.E2E_RETRIES ?? (CI ? 2 : 0))

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  workers: WORKERS,
  retries: RETRIES,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // specs/private may be a symlink into an out-of-tree overlay: the testDir
    // walk skips symlinked dirs, so it is its own project, and the `e2e` script
    // runs node with --preserve-symlinks so its imports resolve from here.
    ...(existsSync(PRIVATE_SPECS)
      ? [{ name: 'chromium-private', testDir: PRIVATE_SPECS, use: { browserName: 'chromium' } }]
      : []),
  ],
  webServer: {
    // --port must match, or Playwright waits on a port Vite never binds.
    command: `yarn dev --port ${PORT} --strictPort`,
    cwd: '../frontend',
    port: PORT,
    reuseExistingServer: true,
    timeout: 30_000,
    // Analyze runs the real client-WASM engine in-browser. Cap threads and the
    // search budget so parallel Playwright workers don't oversubscribe the CPU
    // (each worker boots its own multi-threaded Stockfish). The budget bounds
    // wall-clock directly — it is not one of the offered ANALYSIS_TIME_STEPS,
    // which bound only user-entered stored values.
    env: {
      VITE_ENGINE_THREADS_CAP: '2',
      VITE_DEFAULT_ANALYSIS_TIME_MS: '1500',
      // The 10s product default is a UX bound. Booting WASM+NNUE off an
      // unbundled dev server on a cold runner legitimately exceeds it, and a
      // boot rejection surfaces as zero lines for the rest of the test.
      VITE_ENGINE_BOOT_TIMEOUT_MS: '30000',
      // Branch grading (Review deviations) now drives its own WASM search to the
      // review depth before grading; floor it low so the eval-payload path is
      // fast. The 14–24 bound in storage.ts guards only user-entered stored
      // values — this config default passes through unclamped.
      VITE_DEFAULT_REVIEW_DEPTH: '8',
      // Keep two-snapshot review fixtures fast while still exposing progress.
      VITE_REVIEW_ACTIVE_POLL_MS: '200',
    },
  },
  tsconfig: './tsconfig.json',
})
