/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Cross-origin isolation: required for SharedArrayBuffer → multi-threaded WASM
// Stockfish (analyze tab). Must be sent by every context serving the app
// (dev, preview, and prod host/CDN).
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// `@private` is the not-open-sourced UI (stats, explain): src/private when the
// overlay is present, else the no-op stub. VITE_PRIVATE_DIR overrides both.
const privateDir = process.env.VITE_PRIVATE_DIR
  ?? (existsSync(new URL('./src/private', import.meta.url)) ? './src/private' : './src/private-stub')

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: { postBanner: '/*! Third-party licenses: /licenses/THIRD_PARTY.txt */' },
    },
  },
  resolve: {
    alias: { '@private': fileURLToPath(new URL(privateDir, import.meta.url)) },
    // src/private may be a symlink into an out-of-tree overlay; its relative
    // imports must resolve from here, not from the link's target.
    preserveSymlinks: true,
  },
  server: { headers: coiHeaders },
  preview: { headers: coiHeaders },
  css: {
    modules: {
      generateScopedName: '[name]__[local]',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    css: false,
    exclude: ['node_modules', 'dist'],
  },
})
