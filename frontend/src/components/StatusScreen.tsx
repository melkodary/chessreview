import type { ReactNode } from 'react'
import styles from './StatusScreen.module.css'

interface Props {
  children: ReactNode
}

export default function StatusScreen({ children }: Props) {
  return <div className={styles.screen}>{children}</div>
}
