import '@testing-library/jest-dom'

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open')
    }
  }
}

// vitest 4 ships a built-in localStorage stub that lacks `clear()`. Replace it
// with a small in-memory polyfill so tests can reset state between cases.
{
  const storage = new Map<string, string>()
  const stub: Storage = {
    getItem: (k) => (storage.has(k) ? (storage.get(k) as string) : null),
    setItem: (k, v) => { storage.set(k, String(v)) },
    removeItem: (k) => { storage.delete(k) },
    clear: () => { storage.clear() },
    key: (i) => Array.from(storage.keys())[i] ?? null,
    get length() { return storage.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, writable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: stub, writable: true })
  }
}
