import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { generateNotices } from './licenses.mjs'

it('retains notices for transitive code prebundled by react-chessboard', () => {
  const notices = generateNotices()
  for (const file of ['@dnd-kit/core/LICENSE', 'tslib/LICENSE.txt', 'tslib/CopyrightNotice.txt']) {
    const text = readFileSync(resolve(import.meta.dirname, '../node_modules', file), 'utf8').trim()
    expect(notices).toContain(text)
  }
})
