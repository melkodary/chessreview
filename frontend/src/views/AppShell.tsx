import { Link, Outlet, useParams, useSearchParams } from 'react-router-dom'
import { asSource } from '../api/sources'
import { routes } from '../router'
import Settings from '../components/Settings'
import { StatsMenu } from '@private'
import styles from './AppShell.module.css'

const SOURCE_LABEL: Record<string, string> = { chesscom: 'Chess.com', lichess: 'Lichess' }

export default function AppShell() {
  const { userId, gameId } = useParams<{ userId?: string; gameId?: string }>()
  const [params] = useSearchParams()
  const source = asSource(params.get('source'))
  const before = params.get('before') ?? undefined

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {/* On the immersive game view the back-link leads instead — the brand is
            redundant there. Keep it on home + the games list. */}
        {!gameId && <Link to="/" className={styles.brand}>♟ Analyzer</Link>}
        {userId && (
          <div className={styles.context}>
            {gameId ? (
              <Link to={routes.games(source, userId, before)} className={styles.userLink}>
                ‹ {userId}'s games
              </Link>
            ) : (
              <span className={styles.userLabel}>{userId}</span>
            )}
            <span className={styles.sourceBadge}>{SOURCE_LABEL[source]}</span>
          </div>
        )}
        <div className={styles.actions}>
          <StatsMenu />
          <Settings />
        </div>
      </header>
      <div className={styles.outlet}>
        <Outlet />
      </div>
    </div>
  )
}
