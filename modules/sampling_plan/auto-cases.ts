// Auto Calculate Sampling (Kenneth, 26 October 2026): the cases to sample of
// each size, from the order. One of three ways the sampling plan comes in,
// beside typing it and Steri-AI reading a photo of the written table. Each
// size takes its share of the square root of the order's cases, rounded up:
// ⌈√(total cases) × the size's cases ÷ total cases⌉, never more than the
// size's own cases. Where Sampling Settings say so (Kenneth, 27 October 2026:
// "round up to nearest tenth or five"), the share is then rounded up to the
// next multiple of 5 or 10, still never more than the size's own cases.
import type { CaseRounding } from "./schema";

/** Below this, a product is taken as the whole number it should be (√100 × 50 ÷ 100 is 5, not 5.000…1). */
const EPSILON = 1e-9;

/**
 * Each ordered size's cases to sample, or null while a size has no order
 * quantity above zero: the share needs the whole order. `roundTo` rounds
 * each share up to its next multiple; null leaves it as the formula gives it.
 */
export function autoSampleCases(
  sizes: readonly string[],
  orderCases: (size: string) => number | null,
  roundTo: CaseRounding | null = null,
): Record<string, number> | null {
  if (sizes.length === 0) return null;
  const cases = sizes.map((size) => orderCases(size));
  if (cases.some((value) => value === null || value <= 0)) return null;
  const counts = cases as number[];
  const total = counts.reduce((sum, value) => sum + value, 0);
  const root = Math.sqrt(total);
  return Object.fromEntries(
    sizes.map((size, index) => {
      const own = counts[index];
      const share = Math.ceil((root * own) / total - EPSILON);
      return [size, Math.min(own, roundTo === null ? share : Math.ceil(share / roundTo) * roundTo)];
    }),
  );
}
