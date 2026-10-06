// Summary statistics for measurement columns (BUILD_SPEC 6.1: a template
// reports dimensions as a median, EN 455 style, or an average, ASTM style).

export type StatisticKind = "median" | "average";

function assertFinite(values: readonly number[]): void {
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  }
}

/** Middle value; the mean of the two middle values for an even count. Null when empty. */
export function median(values: readonly number[]): number | null {
  assertFinite(values);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arithmetic mean. Null when empty. */
export function mean(values: readonly number[]): number | null {
  assertFinite(values);
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function statistic(kind: StatisticKind, values: readonly number[]): number | null {
  return kind === "median" ? median(values) : mean(values);
}

/**
 * Rounds half away from zero, as Excel's ROUND does (the reports come from
 * Excel). toPrecision(15) first drops binary noise, so 1.005 rounds to 1.01.
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) {
    throw new RangeError(`decimals must be an integer from 0 to 10, got ${decimals}`);
  }
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  const rounded = (Math.sign(value) * Math.round(scaled)) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
