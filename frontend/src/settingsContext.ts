import { createContext, useContext } from 'react'
import type { SettingsTab, Theme } from './storage'

interface SettingsContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  analysisTimeMs: number
  setAnalysisTimeMs: (ms: number) => void
  analysisLines: number
  setAnalysisLines: (v: number) => void
  reviewDepth: number
  setReviewDepth: (d: number) => void
  reviewMultiPv: number
  setReviewMultiPv: (m: number) => void
  engineThreads: number
  setEngineThreads: (n: number) => void
  engineHash: number
  setEngineHash: (n: number) => void
  provisionalCurve: boolean
  setProvisionalCurve: (on: boolean) => void
  settingsTab: SettingsTab
  setSettingsTab: (t: SettingsTab) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const v = useContext(SettingsContext)
  if (!v) throw new Error('useSettings must be used inside SettingsProvider')
  return v
}
