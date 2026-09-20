import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DEFAULTS,
  SETTINGS_STORAGE,
  STORAGE_KEYS,
} from './storage'
import { ANALYSIS_TIME_STEPS } from './config'

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes validated load and serialized save through one descriptor', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'light')
    expect(SETTINGS_STORAGE.theme.load()).toBe('light')

    SETTINGS_STORAGE.theme.save('dark')
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark')
  })

  it.each([
    ['theme default', STORAGE_KEYS.theme, null, DEFAULTS.theme, SETTINGS_STORAGE.theme.load],
    ['theme valid', STORAGE_KEYS.theme, 'dark', 'dark', SETTINGS_STORAGE.theme.load],
    ['theme garbage', STORAGE_KEYS.theme, 'rainbow', DEFAULTS.theme, SETTINGS_STORAGE.theme.load],
    ['analysis time default', STORAGE_KEYS.analysisTimeMs, null, DEFAULTS.analysisTimeMs, SETTINGS_STORAGE.analysisTimeMs.load],
    ['analysis time offered step', STORAGE_KEYS.analysisTimeMs, String(ANALYSIS_TIME_STEPS[0] * 1000), ANALYSIS_TIME_STEPS[0] * 1000, SETTINGS_STORAGE.analysisTimeMs.load],
    ['analysis time off-step', STORAGE_KEYS.analysisTimeMs, '7500', DEFAULTS.analysisTimeMs, SETTINGS_STORAGE.analysisTimeMs.load],
    ['analysis time in seconds', STORAGE_KEYS.analysisTimeMs, '20', DEFAULTS.analysisTimeMs, SETTINGS_STORAGE.analysisTimeMs.load],
    ['analysis time non-numeric', STORAGE_KEYS.analysisTimeMs, 'banana', DEFAULTS.analysisTimeMs, SETTINGS_STORAGE.analysisTimeMs.load],
    ['settings tab default', STORAGE_KEYS.settingsTab, null, DEFAULTS.settingsTab, SETTINGS_STORAGE.settingsTab.load],
    ['settings tab valid', STORAGE_KEYS.settingsTab, 'review', 'review', SETTINGS_STORAGE.settingsTab.load],
    ['settings tab garbage', STORAGE_KEYS.settingsTab, 'nonsense', DEFAULTS.settingsTab, SETTINGS_STORAGE.settingsTab.load],
  ] as const)('loads %s', (_name, key, raw, expected, load) => {
    if (raw !== null) localStorage.setItem(key, raw)
    expect(load()).toBe(expected)
  })

  describe('loadEngineThreads', () => {
    const setCores = (n: number) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: n, configurable: true })
    }
    afterEach(() => setCores(8))

    it.each([
      ['computed default', 4, null, 4],
      ['stored value', 8, '6', 6],
      ['hardware clamp', 4, '16', 4],
      ['non-numeric fallback', 4, 'banana', 4],
    ] as const)('%s', (_name, cores, raw, expected) => {
      setCores(cores)
      if (raw !== null) localStorage.setItem(STORAGE_KEYS.engineThreads, raw)
      expect(SETTINGS_STORAGE.engineThreads.load()).toBe(expected)
    })
  })

  describe('loadEngineHash', () => {
    it.each([
      ['default', null, DEFAULTS.engineHash],
      ['allowed step', '256', 256],
      ['nearest step', '100', 128],
      ['non-numeric fallback', 'banana', DEFAULTS.engineHash],
    ] as const)('%s', (_name, raw, expected) => {
      if (raw !== null) localStorage.setItem(STORAGE_KEYS.engineHash, raw)
      expect(SETTINGS_STORAGE.engineHash.load()).toBe(expected)
    })
  })

  it.each([
    ['theme', STORAGE_KEYS.theme, 'dark', () => SETTINGS_STORAGE.theme.save('dark')],
    ['analysis time', STORAGE_KEYS.analysisTimeMs, '10000', () => SETTINGS_STORAGE.analysisTimeMs.save(10_000)],
    ['engine threads', STORAGE_KEYS.engineThreads, '4', () => SETTINGS_STORAGE.engineThreads.save(4)],
    ['engine hash', STORAGE_KEYS.engineHash, '128', () => SETTINGS_STORAGE.engineHash.save(128)],
    ['settings tab', STORAGE_KEYS.settingsTab, 'review', () => SETTINGS_STORAGE.settingsTab.save('review')],
  ] as const)('serializes %s', (_name, key, expected, save) => {
    save()
    expect(localStorage.getItem(key)).toBe(expected)
  })
})
