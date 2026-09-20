import styles from './NavButton.module.css'

interface Props {
  label: string
  onClick: () => void
  disabled?: boolean
}

export default function NavButton({ label, onClick, disabled }: Props) {
  return (
    <button className={styles.btn} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
