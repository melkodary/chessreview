import styles from './ReviewProgress.module.css'

interface Props {
  reviewed: number
  total: number
  onCancel: () => void
}

export default function ReviewProgress({ reviewed, total, onCancel }: Props) {
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0
  return (
    <div className={styles.root}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.counter}>Analyzing… {reviewed} / {total}</span>
      <button className={styles.cancelBtn} onClick={onCancel} aria-label="Cancel review">✕</button>
    </div>
  )
}
