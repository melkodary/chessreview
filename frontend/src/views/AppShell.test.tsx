import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from '../settings'
import AppShell from './AppShell'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div data-testid="outlet" />} />
            <Route path="/:userId/games" element={<div data-testid="outlet" />} />
            <Route path="/:userId/games/:gameId" element={<div data-testid="outlet" />} />
            <Route path="/:userId/games/:gameId/:tab" element={<div data-testid="outlet" />} />
          </Route>
        </Routes>
      </SettingsProvider>
    </MemoryRouter>,
  )
}

describe('AppShell gear', () => {
  it('gear button is always present', () => {
    const { getByTitle } = renderAt('/alice/games')
    expect(getByTitle('Settings')).toBeInTheDocument()
  })

  it('gear click opens the settings panel', () => {
    const { getByTitle, queryByText } = renderAt('/alice/games')
    expect(queryByText('Appearance')).toBeNull()
    fireEvent.click(getByTitle('Settings'))
    expect(queryByText('Appearance')).toBeInTheDocument()
  })

  it('Esc closes the settings panel', () => {
    const { getByTitle, queryByText } = renderAt('/alice/games')
    fireEvent.click(getByTitle('Settings'))
    expect(queryByText('Appearance')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(queryByText('Appearance')).toBeNull()
  })

  it('click outside closes the settings panel', () => {
    const { getByTitle, queryByText } = renderAt('/alice/games')
    fireEvent.click(getByTitle('Settings'))
    expect(queryByText('Appearance')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(queryByText('Appearance')).toBeNull()
  })

  it('gear is present on home (no userId)', () => {
    const { getByTitle } = renderAt('/')
    expect(getByTitle('Settings')).toBeInTheDocument()
  })
})

describe('AppShell brand', () => {
  it('shows the brand on home', () => {
    expect(renderAt('/').getByRole('link', { name: /Analyzer/i })).toBeInTheDocument()
  })

  it('shows the brand on the games list', () => {
    expect(renderAt('/alice/games').getByRole('link', { name: /Analyzer/i })).toBeInTheDocument()
  })

  it('hides the brand on the game view — the back-link leads there', () => {
    const { queryByRole } = renderAt('/alice/games/game123/analyze')
    expect(queryByRole('link', { name: /Analyzer/i })).toBeNull()
  })
})

describe('AppShell back-link', () => {
  it('on games-list route, userId is a plain label (no self-link)', () => {
    const { getByText } = renderAt('/alice/games')
    const el = getByText('alice')
    expect(el.tagName.toLowerCase()).toBe('span')
  })

  it('on game route, userId renders as a link to the games list', () => {
    const { getByRole } = renderAt('/alice/games/game123/analyze')
    const link = getByRole('link', { name: /alice's games/i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toContain('/alice/games')
  })

  it('preserves the raw date anchor in the games breadcrumb', () => {
    const { getByRole } = renderAt('/alice/games/game123/analyze?source=lichess&before=not-valid')
    expect(getByRole('link', { name: /alice's games/i })).toHaveAttribute(
      'href', '/alice/games?source=lichess&before=not-valid',
    )
  })
})
