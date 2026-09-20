/* Config for the screenshot harnesses in ./tools and ./private — separate from
   playwright.config.ts so `yarn e2e` (testDir ./specs) never runs them. They
   assert nothing; they exist to render the real app for visual review. */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const PRIVATE_SHOTS = fileURLToPath(new URL('./private', import.meta.url))
const chromium = { use: { browserName: 'chromium' as const } }

export default defineConfig({
  ...base,
  testDir: './tools',
  // ./private is the overlay's symlink (see playwright.config.ts).
  projects: [
    { name: 'chromium', ...chromium },
    ...(existsSync(PRIVATE_SHOTS) ? [{ name: 'chromium-private', testDir: PRIVATE_SHOTS, ...chromium }] : []),
  ],
  workers: 1,
})
