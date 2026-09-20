import { useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettings } from '../settingsContext'
import { useDismiss } from '../hooks/useDismiss'
import { ANALYSIS_TIME_STEPS, ENGINE_HASH_STEPS } from '../config'
import { ENGINE_MB, ENGINE_URL } from '../storage'
import type { SettingsTab } from '../storage'
import { useEngineStatus } from '../hooks/useEngineStatus'
import styles from './Settings.module.css'

export default function Settings() {
  // Read per-render (not module scope) so tests can stub navigator.hardwareConcurrency
  // before mounting; a module-level constant would freeze at first import instead.
  const maxThreads = Math.max(1, navigator.hardwareConcurrency ?? 2)
  const { theme, setTheme, analysisTimeMs, setAnalysisTimeMs, analysisLines, setAnalysisLines, reviewDepth, setReviewDepth, reviewMultiPv, setReviewMultiPv, engineThreads, setEngineThreads, engineHash, setEngineHash, provisionalCurve, setProvisionalCurve, settingsTab, setSettingsTab } = useSettings()
  const engineStatus = useEngineStatus()
  const isLiteActive = engineStatus.state === 'ready' && engineStatus.url === ENGINE_URL
  const { pathname } = useLocation()
  const routeMode: SettingsTab | null = pathname.endsWith('/analyze') ? 'analysis'
    : pathname.endsWith('/review') ? 'review' : null
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<SettingsTab>(routeMode ?? settingsTab)
  const panelRef = useRef<HTMLDivElement>(null)

  const toggleOpen = () => {
    if (!open) setTab(routeMode ?? settingsTab)
    setOpen(!open)
  }

  const selectTab = (next: SettingsTab) => {
    setTab(next)
    setSettingsTab(next)
  }

  useDismiss(open, panelRef, setOpen)

  return (
    <div className={styles.root} ref={panelRef}>
      <button
        className={styles.toggle}
        onClick={toggleOpen}
        title="Settings"
      >
        ⚙
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.section}>
            <div className={styles.label}>Appearance</div>
            <div className={styles.themeRow}>
              {(['light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`${styles.themeBtn} ${theme === t ? styles.themeBtnActive : ''}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'analysis' ? styles.tabActive : ''}`}
              onClick={() => selectTab('analysis')}
            >
              Analysis
            </button>
            <button
              className={`${styles.tab} ${tab === 'review' ? styles.tabActive : ''}`}
              onClick={() => selectTab('review')}
            >
              Review
            </button>
          </div>

          {tab === 'analysis' && (
            <div>
              <div className={styles.label}>Max time: {analysisTimeMs / 1000}s</div>
              <input
                type="range"
                min={0}
                max={ANALYSIS_TIME_STEPS.length - 1}
                value={ANALYSIS_TIME_STEPS.indexOf(analysisTimeMs / 1000)}
                onChange={(e) => setAnalysisTimeMs(ANALYSIS_TIME_STEPS[Number(e.target.value)] * 1000)}
                className={styles.slider}
                data-testid="analysis-time-slider"
              />
              <div className={styles.scale}>
                <span>{ANALYSIS_TIME_STEPS[0]}s</span><span>{ANALYSIS_TIME_STEPS[ANALYSIS_TIME_STEPS.length - 1]}s</span>
              </div>
              <div className={`${styles.label} ${styles.spaced}`}>Lines: {analysisLines}</div>
              <input
                type="range"
                min={2}
                max={5}
                value={analysisLines}
                onChange={(e) => setAnalysisLines(Number(e.target.value))}
                className={styles.slider}
              />
              <div className={styles.scale}>
                <span>2</span><span>5</span>
              </div>
              <div className={`${styles.label} ${styles.spaced}`}>Threads: {engineThreads}</div>
              <input
                type="range"
                min={1}
                max={maxThreads}
                value={engineThreads}
                onChange={(e) => setEngineThreads(Number(e.target.value))}
                className={styles.slider}
                data-testid="threads-slider"
              />
              <div className={styles.scale}>
                <span>1</span><span>{maxThreads}</span>
              </div>
              <div className={`${styles.label} ${styles.spaced}`}>Hash: {engineHash} MB</div>
              <input
                type="range"
                min={0}
                max={ENGINE_HASH_STEPS.length - 1}
                value={ENGINE_HASH_STEPS.indexOf(engineHash)}
                onChange={(e) => setEngineHash(ENGINE_HASH_STEPS[Number(e.target.value)])}
                className={styles.slider}
                data-testid="hash-slider"
              />
              <div className={styles.scale}>
                <span>{ENGINE_HASH_STEPS[0]}</span><span>{ENGINE_HASH_STEPS[ENGINE_HASH_STEPS.length - 1]}</span>
              </div>

              <div className={`${styles.section} ${styles.spaced}`}>
                <div className={styles.label}>Engine</div>
                <div className={styles.scale}>lite (~{ENGINE_MB} MB)</div>
                {isLiteActive && (
                  <div className={styles.status}>
                    <span className={styles.activePill}>Active</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'review' && (
            <div>
              <div className={styles.label}>Review Depth: {reviewDepth}</div>
              <input
                type="range"
                min={14}
                max={24}
                value={reviewDepth}
                onChange={(e) => setReviewDepth(Number(e.target.value))}
                className={styles.slider}
              />
              <div className={styles.scale}>
                <span>14</span><span>24</span>
              </div>
              <div className={`${styles.label} ${styles.spaced}`}>MultiPV: {reviewMultiPv}</div>
              <input
                type="range"
                min={2}
                max={4}
                value={reviewMultiPv}
                onChange={(e) => setReviewMultiPv(Number(e.target.value))}
                className={styles.slider}
              />
              <div className={styles.scale}>
                <span>2</span><span>4</span>
              </div>
              <div className={`${styles.label} ${styles.spaced}`}>Browser engine</div>
              <div className={styles.optionRow}>
                {([true, false] as const).map((on) => (
                  <button
                    key={String(on)}
                    onClick={() => setProvisionalCurve(on)}
                    className={`${styles.optionBtn} ${provisionalCurve === on ? styles.optionBtnActive : ''}`}
                  >
                    {on ? 'on' : 'off'}
                  </button>
                ))}
              </div>
              <div className={styles.scale}>
                <span>Sketch the eval graph and run reviews in the browser engine. Off sends reviews to the server.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
