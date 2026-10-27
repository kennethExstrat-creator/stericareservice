// Each size's share of the cases ordered, the weighting Auto Calculate's
// cases follow (auto-cases.ts: ⌈√N × nᵢ/N⌉). The Order Qty row swaps to it on
// demand (Kenneth, 27 October 2026: "give me a swap button beside the order
// qty row so that when pressed, the data switch to weighted average %").

/** "24.6%": a size's cases as a share of all the cases ordered, one decimal; null while either is missing, or with none ordered. */
export function orderShareText(cases: number | null, total: number | null): string | null {
  if (cases === null || total === null || total <= 0) return null;
  return `${((cases / total) * 100).toFixed(1)}%`;
}

/** The shares' total: "100%" once any case is ordered, null before. */
export function orderShareTotalText(total: number | null): string | null {
  return total === null || total <= 0 ? null : "100%";
}
