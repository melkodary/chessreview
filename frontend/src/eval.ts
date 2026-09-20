interface EvalInfo {
  evaluation: number
  mate: number | null
}

// Shared mate/sign/precision core. `plusAtZero` controls the sign of an exact
// 0.0: the eval bar reads a dead-level position as "0.0" (no plus), while a
// move badge reads it as "+0.00" — a small deliberate difference the two
// exports below preserve.
function format(evaluation: number, mate: number | null, decimals: number, plusAtZero: boolean): string {
  if (mate !== null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`
  const sign = (plusAtZero ? evaluation >= 0 : evaluation > 0) ? '+' : ''
  return sign + evaluation.toFixed(decimals)
}

// Eval bar / best-lines: 1-decimal, no plus at exact zero.
export function formatEval(info: EvalInfo): string {
  return format(info.evaluation, info.mate, 1, false)
}

// Move-eval badges (EvalGraph tooltip, GuideBubble): 2-decimal, plus at zero.
export function formatMoveEval(evaluation: number, mate: number | null): string {
  return format(evaluation, mate, 2, true)
}

export function isWhiteAhead(info: EvalInfo): boolean {
  if (info.mate !== null) return info.mate > 0
  return info.evaluation >= 0
}

// White's share of the eval bar (0–100%). Mate forces a full bar to the
// mating side; otherwise a linear ramp clamped to [0, 100].
export function whitePercent(evaluation: number, mate: number | null): number {
  if (mate !== null) return mate > 0 ? 100 : 0
  return Math.min(Math.max(50 + evaluation * 10, 0), 100)
}
