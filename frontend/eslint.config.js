import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // frontend/AGENTS.md: persisted prefs go through storage.ts; static styles live in CSS Modules
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'Use useSettings() / storage.ts.' }],
      'no-restricted-properties': ['error', { object: 'window', property: 'localStorage', message: 'Use useSettings() / storage.ts.' }],
      'no-restricted-syntax': ['error', {
        selector: 'JSXAttribute[name.name="style"] ObjectExpression > Property[value.type="Literal"]',
        message: 'Static style value: put it in the CSS Module. Inline style is for runtime-computed values only.',
      }],
    },
  },
  {
    files: ['src/storage.ts', 'src/setupTests.ts', 'src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
])
