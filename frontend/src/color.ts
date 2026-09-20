export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace('#', '')
  if (clean.length !== 6) return `rgba(0,0,0,${alpha})`
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(0,0,0,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}
