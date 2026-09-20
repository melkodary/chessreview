import type { Theme } from './types'

export function applyTheme(theme: Theme, mode: 'light' | 'dark'): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme[mode])) {
    root.style.setProperty('--' + key, value)
  }
  root.style.setProperty('--font-display', theme.fonts.display)
  root.style.setProperty('--font-body', theme.fonts.body)
  root.style.setProperty('--font-mono', theme.fonts.mono)
  root.dataset.skin = theme.name
  root.setAttribute('data-theme', mode)
}
