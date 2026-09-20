import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SettingsProvider } from './settings'
import { useSettings } from './settingsContext'
import { STORAGE_KEYS } from './storage'

function Probe() {
  const { theme, analysisTimeMs, analysisLines, setTheme, setAnalysisTimeMs, setAnalysisLines } = useSettings()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="time">{analysisTimeMs}</span>
      <span data-testid="lines">{analysisLines}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setAnalysisTimeMs(60_000)}>t60</button>
      <button onClick={() => setAnalysisLines(5)}>l5</button>
    </div>
  )
}

describe('SettingsProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('initializes from defaults when storage empty', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(screen.getByTestId('time').textContent).toBe('20000')
    expect(screen.getByTestId('lines').textContent).toBe('3')
  })

  it('initializes from localStorage when present', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'dark')
    localStorage.setItem(STORAGE_KEYS.analysisTimeMs, '10000')
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(screen.getByTestId('time').textContent).toBe('10000')
  })

  it('setTheme updates state and DOM data-theme', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    act(() => {
      screen.getByText('light').click()
    })
    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('light')
  })

  it('setAnalysisTimeMs updates state and persists', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    act(() => {
      screen.getByText('t60').click()
    })
    expect(screen.getByTestId('time').textContent).toBe('60000')
    expect(localStorage.getItem(STORAGE_KEYS.analysisTimeMs)).toBe('60000')
  })

  it('setAnalysisLines defaults to 3, updates state and persists', () => {
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    )
    expect(screen.getByTestId('lines').textContent).toBe('3')
    act(() => {
      screen.getByText('l5').click()
    })
    expect(screen.getByTestId('lines').textContent).toBe('5')
    expect(localStorage.getItem(STORAGE_KEYS.analysisLines)).toBe('5')
  })

  it('throws when useSettings called outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/SettingsProvider/)
    spy.mockRestore()
  })
})
