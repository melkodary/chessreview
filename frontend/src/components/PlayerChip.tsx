import styles from './PlayerChip.module.css'

interface Props {
  name: string
  rating?: string
}

export default function PlayerChip({ name, rating }: Props) {
  return (
    <div className={styles.chip}>
      <span className={styles.prompt}>{'>'}</span>
      <div className={styles.name}>{name}</div>
      {rating && <div className={styles.rating}>{rating}</div>}
    </div>
  )
}
