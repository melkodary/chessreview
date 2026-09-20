import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { SETTINGS_STORAGE } from './storage'
import { ACTIVE } from './theme/active'
import { applyTheme } from './theme/applyTheme'
import { SettingsContext } from './settingsContext'
import { useStoredSetting } from './useStoredSetting'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useStoredSetting(SETTINGS_STORAGE.theme)
  const [analysisTimeMs, setAnalysisTimeMs] = useStoredSetting(SETTINGS_STORAGE.analysisTimeMs)
  const [analysisLines, setAnalysisLines] = useStoredSetting(SETTINGS_STORAGE.analysisLines)
  const [reviewDepth, setReviewDepth] = useStoredSetting(SETTINGS_STORAGE.reviewDepth)
  const [reviewMultiPv, setReviewMultiPv] = useStoredSetting(SETTINGS_STORAGE.reviewMultiPv)
  const [engineThreads, setEngineThreads] = useStoredSetting(SETTINGS_STORAGE.engineThreads)
  const [engineHash, setEngineHash] = useStoredSetting(SETTINGS_STORAGE.engineHash)
  const [provisionalCurve, setProvisionalCurve] = useStoredSetting(SETTINGS_STORAGE.provisionalCurve)
  const [settingsTab, setSettingsTab] = useStoredSetting(SETTINGS_STORAGE.settingsTab)

  useEffect(() => {
    applyTheme(ACTIVE, theme)
  }, [theme])

  return (
    <SettingsContext.Provider value={{ theme, setTheme, analysisTimeMs, setAnalysisTimeMs, analysisLines, setAnalysisLines, reviewDepth, setReviewDepth, reviewMultiPv, setReviewMultiPv, engineThreads, setEngineThreads, engineHash, setEngineHash, provisionalCurve, setProvisionalCurve, settingsTab, setSettingsTab }}>
      {children}
    </SettingsContext.Provider>
  )
}
