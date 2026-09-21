import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { skin } from '@private'
import { ACTIVE } from './theme/active'
import { applyTheme } from './theme/applyTheme'
import { SETTINGS_STORAGE } from './storage'
import './styles/theme.css'
import './styles/global.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { SettingsProvider } from './settings'

// Synchronous before first paint — no FOUC
applyTheme(ACTIVE, SETTINGS_STORAGE.theme.load())

// @private's classification palette override, if any — same before-first-paint path.
for (const [id, hex] of Object.entries(skin.palette ?? {})) {
  document.documentElement.style.setProperty(`--review-${id}`, hex)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </SettingsProvider>
  </StrictMode>,
)
