import styles from './viewer.module.css'

export default function ExplorationBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.exploreBanner} data-testid="explore-banner">
      <span className={styles.exploreLabel}>⌕ Exploring variation</span>
      <button className={styles.exploreReset} onClick={onReset}>
        ⟲ Reset to game
      </button>
    </div>
  )
}
