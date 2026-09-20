import { useEffect } from 'react'

const BASE = 'Chess Review'

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE
  }, [title])
}
