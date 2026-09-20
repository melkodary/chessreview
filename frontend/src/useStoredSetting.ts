import { useState } from 'react'
import type { StoredSetting } from './storage'

export function useStoredSetting<T>(setting: StoredSetting<T>) {
  const [value, setValue] = useState(setting.load)
  const update = (next: T) => {
    setting.save(next)
    setValue(next)
  }
  return [value, update] as const
}
