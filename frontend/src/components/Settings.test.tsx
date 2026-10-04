import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '../settings'
import { ENGINE_URL, STORAGE_KEYS } from '../storage'
import { ANALYSIS_TIME_STEPS } from '../config'
import Settings from './Settings'

let engineStatusValue: { url: string; state: string } = { url: '', state: 'idle' }
vi.mock('../hooks/useEngineStatus', () => ({
  useEngineStatus: () => engineStatusValue,
}))

function open(path = '/') {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>
        <Settings />
      </SettingsProvider>
    </MemoryRouter>,
  )
  fireEvent.click(utils.getByTitle('Settings'))
  return utils
}

beforeEach(() => {
  localStorage.clear()
  engineStatusValue = { url: '', state: 'idle' }
  // Settings' MAX_THREADS reads navigator.hardwareConcurrency; pin it so the
  // threads-slider range is deterministic regardless of the host/CI core count.
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
})

describe('Settings', () => {
  it('opens with Analysis tab active: Max time + Lines shown, Review controls absent', () => {
    const { queryByText } = open()
    expect(queryByText('Appearance')).toBeInTheDocument()
    expect(queryByText(/Max time:/)).toBeInTheDocument()
    expect(queryByText(/Lines:/)).toBeInTheDocument()
    expect(queryByText(/Review Depth/)).not.toBeInTheDocument()
    expect(queryByText(/MultiPV/)).not.toBeInTheDocument()
  })

  it('clicking Review tab swaps content: Review Depth + MultiPV shown, Max time + Lines absent', () => {
    const { getByText, queryByText } = open()
    fireEvent.click(getByText('Review'))
    expect(queryByText(/Review Depth/)).toBeInTheDocument()
    expect(queryByText(/MultiPV/)).toBeInTheDocument()
    expect(queryByText(/Max time:/)).not.toBeInTheDocument()
    expect(queryByText(/Lines:/)).not.toBeInTheDocument()
  })

  it('theme buttons stay visible regardless of active tab', () => {
    const { getByText, queryByText } = open()
    fireEvent.click(getByText('Review'))
    expect(queryByText('light')).toBeInTheDocument()
    expect(queryByText('dark')).toBeInTheDocument()
  })

  it('max-time slider indexes the offered steps and persists the picked budget in ms', () => {
    const { getByTestId } = open()
    const slider = getByTestId('analysis-time-slider') as HTMLInputElement
    expect(slider.max).toBe(String(ANALYSIS_TIME_STEPS.length - 1))

    fireEvent.change(slider, { target: { value: '0' } })
    expect(localStorage.getItem(STORAGE_KEYS.analysisTimeMs))
      .toBe(String(ANALYSIS_TIME_STEPS[0] * 1000))
  })

  it('no depth control on the Analysis tab', () => {
    const { queryByText } = open()
    expect(queryByText(/Analysis depth/)).not.toBeInTheDocument()
  })

  it('lines slider ranges 2–5', () => {
    // Min 2: the deviation grader needs a second-best line (after_second).
    const { container } = open()
    const slider = container.querySelector('input[min="2"][max="5"]')
    expect(slider).not.toBeNull()
  })

  it('review depth slider ranges 14–24', () => {
    const { getByText, container } = open()
    fireEvent.click(getByText('Review'))
    const slider = container.querySelector('input[min="14"][max="24"]')
    expect(slider).not.toBeNull()
  })

  it('multipv slider ranges 2–4', () => {
    const { getByText, container } = open()
    fireEvent.click(getByText('Review'))
    const slider = container.querySelector('input[min="2"][max="4"]')
    expect(slider).not.toBeNull()
  })

  it('provisional-curve switch lives on the Review tab and persists both ways', () => {
    const { getByText, queryByText } = open()
    expect(queryByText('Browser engine')).not.toBeInTheDocument()
    fireEvent.click(getByText('Review'))
    expect(queryByText('Browser engine')).toBeInTheDocument()

    fireEvent.click(getByText('off'))
    expect(localStorage.getItem(STORAGE_KEYS.provisionalCurve)).toBe('false')
    fireEvent.click(getByText('on'))
    expect(localStorage.getItem(STORAGE_KEYS.provisionalCurve)).toBe('true')
  })

  it('Threads + Hash sliders render on the Analysis tab, not Review', () => {
    const { getByText, queryByText } = open()
    expect(queryByText(/Threads:/)).toBeInTheDocument()
    expect(queryByText(/Hash:/)).toBeInTheDocument()
    fireEvent.click(getByText('Review'))
    expect(queryByText(/Threads:/)).not.toBeInTheDocument()
    expect(queryByText(/Hash:/)).not.toBeInTheDocument()
  })

  it('Hash label shows the MB value', () => {
    const { getByText } = open()
    expect(getByText(/Hash: 64 MB/)).toBeInTheDocument()
  })

  it('dragging Threads slider calls setEngineThreads', () => {
    const { container } = open()
    const slider = container.querySelector('[data-testid="threads-slider"]') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '4' } })
    expect(slider.value).toBe('4')
  })

  describe('mode-aware default tab', () => {
    it('opens on Analysis when the route is …/analyze, regardless of persisted value', () => {
      localStorage.setItem(STORAGE_KEYS.settingsTab, 'review')
      const { queryByText } = open('/alice/games/1/analyze')
      expect(queryByText(/Max time:/)).toBeInTheDocument()
      expect(queryByText(/Review Depth/)).not.toBeInTheDocument()
    })

    it('opens on Review when the route is …/review, regardless of persisted value', () => {
      localStorage.setItem(STORAGE_KEYS.settingsTab, 'analysis')
      const { queryByText } = open('/alice/games/1/review')
      expect(queryByText(/Review Depth/)).toBeInTheDocument()
      expect(queryByText(/Max time:/)).not.toBeInTheDocument()
    })

    it('opens on the persisted tab on a modeless page; Analysis when nothing stored', () => {
      const { queryByText } = open('/')
      expect(queryByText(/Max time:/)).toBeInTheDocument()
    })

    it('opens on the persisted tab on a modeless page when Review was stored', () => {
      localStorage.setItem(STORAGE_KEYS.settingsTab, 'review')
      const { queryByText } = open('/')
      expect(queryByText(/Review Depth/)).toBeInTheDocument()
    })

    it('a manual switch to Review persists across close/reopen on a modeless page', () => {
      const { getByTitle, getByText, queryByText } = open('/')
      fireEvent.click(getByText('Review'))
      fireEvent.click(getByTitle('Settings')) // close
      fireEvent.click(getByTitle('Settings')) // reopen
      expect(queryByText(/Review Depth/)).toBeInTheDocument()
    })

    it('applying the route-mode default does not persist', () => {
      const onReview = open('/alice/games/1/review')
      expect(onReview.queryByText(/Review Depth/)).toBeInTheDocument()
      onReview.unmount()

      const modeless = open('/')
      expect(modeless.queryByText(/Max time:/)).toBeInTheDocument()
    })
  })

  describe('Engine', () => {
    it('renders on the Analysis tab, not the Review tab', () => {
      const { getByText, queryByText } = open()
      expect(queryByText('Engine')).toBeInTheDocument()
      fireEvent.click(getByText('Review'))
      expect(queryByText('Engine')).not.toBeInTheDocument()
    })

    it('ships only lite without an engine selector or full-engine download controls', () => {
      const { getByText, queryByRole, queryByText } = open()
      expect(getByText('lite (~2 MB)')).toBeInTheDocument()
      expect(queryByRole('combobox')).not.toBeInTheDocument()
      expect(queryByText(/full engine/i)).not.toBeInTheDocument()
      expect(queryByText('Download now')).not.toBeInTheDocument()
    })

    it('lite shows only the Active pill when it is the running engine', () => {
      engineStatusValue = { url: ENGINE_URL, state: 'ready' }
      const { getByText } = open()
      expect(getByText('Active')).toBeInTheDocument()
    })

    it('does not show an Active pill for any non-lite engine', () => {
      engineStatusValue = { url: '/engine/other.js', state: 'ready' }
      const { queryByText } = open()
      expect(queryByText('Active')).not.toBeInTheDocument()
    })
  })
})
