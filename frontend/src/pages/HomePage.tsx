import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import UsernameInput from '../views/UsernameInput'
import { getSource } from '../api/sources'
import type { Source } from '../api/types'
import { routes } from '../router'
import styles from './HomePage.module.css'

export default function HomePage() {
  useDocumentTitle()
  const navigate = useNavigate()
  const [latestLoading, setLatestLoading] = useState(false)

  async function handleReviewLatest(username: string, source: Source) {
    setLatestLoading(true)
    try {
      const games = await getSource(source).listRecent(username, 1)
      if (games.length === 0) {
        navigate(routes.games(source, username))
        return
      }
      navigate(routes.review(source, username, games[0].id))
    } catch {
      // Reset only on the error path: the success path has already navigated and
      // unmounted HomePage, so a `finally` would set state on a dead component.
      setLatestLoading(false)
      navigate(routes.games(source, username))
    }
  }

  return (
    <div className={styles.page}>
      <UsernameInput
        onSubmit={(username, source) => navigate(routes.games(source, username))}
        onReviewLatest={handleReviewLatest}
        latestLoading={latestLoading}
      />
    </div>
  )
}
