import styles from './ReviewIntro.module.css'

interface Props {
  onStart: () => void
  error?: string
  depth: number
  lines: number
}

export default function ReviewIntro({ onStart, error, depth, lines }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.crest}>♟</div>
        <h2 className={styles.headline}>Review this game</h2>
        {error ? (
          <>
            <p className={styles.error}>{error}</p>
            <button className={styles.btn} onClick={() => onStart()}>Retry</button>
          </>
        ) : (
          <>
            <p className={styles.sub}>Classify every move and score your accuracy.</p>
            <div className={styles.chips}>
              <span className={styles.chip}>depth {depth}</span>
              <span className={styles.chip}>lines {lines}</span>
            </div>
            <button className={styles.btn} onClick={() => onStart()}>Start review</button>
          </>
        )}
      </div>
    </div>
  )
}
