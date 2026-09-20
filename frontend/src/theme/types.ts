export type CssVarName =
  | 'bg' | 'surface' | 'surface-2' | 'border' | 'text' | 'text-muted'
  | 'accent' | 'accent-bg' | 'eval-positive' | 'eval-negative'
  | 'live' | 'live-bg' | 'move-highlight-bg' | 'move-highlight-text'
  | 'nav-btn-bg' | 'nav-btn-border' | 'nav-btn-text'
  | 'nav-btn-active-bg' | 'nav-btn-active-text'
  | 'board-surround' | 'board-surround-text' | 'board-surround-subtext'
  | 'eval-bar-white' | 'eval-bar-black' | 'eval-bar-bg'
  | 'on-colored'
  | 'hint-dot' | 'hint-ring' | 'hint-pickup'
  | 'status-running' | 'glow-accent' | 'glow-dot'
  | 'gold' | 'gold-bg' | 'glow-gold'

export type Palette = Record<CssVarName, string>

export interface Theme {
  name: 'terminal'
  fonts: {
    display: string
    body: string
    mono: string
  }
  light: Palette
  dark: Palette
}
