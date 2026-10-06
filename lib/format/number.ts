// Numbers for display: fixed decimals (rounded the way the reports' Excel
// ROUND does), trimmed decimals, thousands separators, units and percent.
// Pure and locale-free, so the server and the browser print the same text.
// Show the result in a `tabular-nums` element (Figure does) so columns line up.
import { formatDecimal, roundTo } from "@/lib/stats";

export type NumberFormat = {
  /** Fixed decimals, rounded half away from zero: 2.9 at 2 is "2.90". */
  decimals?: number;
  /** At most this many decimals, trailing zeros dropped: 0.48, 1.1, 0. Ignored with `decimals`. */
  maxDecimals?: number;
  /** Thousands separators: 5,800,000. */
  grouping?: boolean;
  /** Canonical unit after the number: "6 N", "2.90 g"; "%" is attached: "85%". */
  unit?: string;
  /** Text for a missing value (null, undefined, NaN, Infinity). Default "". */
  empty?: string;
};

/** "6 N", "85%", "240 mm": a space before a unit, none before "%". Blank text stays blank. */
export function withUnit(text: string, unit?: string): string {
  if (text === "" || !unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

function group(text: string): string {
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const [whole, fraction] = digits.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * A number as the app prints it. Without `decimals` or `maxDecimals` the value
 * is printed as stored (0.105 stays 0.105); with them it is rounded like
 * Excel's ROUND, so the screen agrees with the report.
 */
export function formatNumber(value: number | null | undefined, format: NumberFormat = {}): string {
  const { decimals, maxDecimals, grouping = false, unit, empty = "" } = format;
  if (value === null || value === undefined || !Number.isFinite(value)) return empty;

  let text: string;
  if (decimals !== undefined) text = formatDecimal(value, decimals);
  else if (maxDecimals !== undefined) text = trimZeros(roundTo(value, maxDecimals).toFixed(maxDecimals));
  else text = String(Object.is(value, -0) ? 0 : value);

  return withUnit(grouping ? group(text) : text, unit);
}

/** A whole count with thousands separators: 5800000 as "5,800,000". */
export function formatCount(value: number | null | undefined, empty = ""): string {
  return formatNumber(value, { grouping: true, empty });
}

/**
 * A value already in percent (layering 88 is 88%), with "%" attached.
 * Canonical data stores percentages this way (BUILD_SPEC 4.2 rule 5).
 */
export function formatPercent(value: number | null | undefined, format: Omit<NumberFormat, "unit"> = {}): string {
  return formatNumber(value, { ...format, unit: "%" });
}

/** A fraction as a percentage number: 0.0048 is 0.48, without binary noise. */
export function toPercent(fraction: number): number {
  return Number((fraction * 100).toPrecision(12));
}
