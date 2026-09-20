import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './views/AppShell'
import HomePage from './pages/HomePage'
import GameListPage from './pages/GameListPage'
import GameShell from './views/GameShell'
import ReviewPanel from './views/ReviewPanel'
import AnalyzePanel from './views/AnalyzePanel'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/:userId/games" element={<GameListPage />} />
          <Route path="/:userId/games/:gameId" element={<GameShell />}>
            <Route index element={<Navigate to="analyze" replace />} />
            <Route path="review" element={<ReviewPanel />} />
            <Route path="analyze" element={<AnalyzePanel />} />
          </Route>
        </Route>
        <Route path="/inbox" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
