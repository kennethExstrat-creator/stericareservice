// Defect rates the way the reports write them:
//   per box   "1/125" (defects / gloves per pack) and 0.008 as a decimal,
//   per size  "3 / 625 (0.48%)", "11 / 1,000 (1.1%)" (defects / gloves
//             inspected, rate; counts with thousands separators, as every
//             count the app prints and as the expected results write them),
//   per size  "1/500" for watertight totals.
import { roundTo } from "@/lib/stats";
import { formatNumber, toPercent } from "./number";

const MISSING = "—";

function isCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** part / whole as a number (1/125 is 0.008); null without a positive whole. */
export function ratio(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (!isCount(part) || !isCount(whole) || whole <= 0) return null;
  return part / whole;
}

/**
 * "1/125", unspaced as the reports print it per box (or "1 / 125" with
 * `spaced`; "1/1,000" with `grouping`). A missing whole prints as "1/—"; a
 * missing part as "".
 */
export function formatRatio(
  part: number | null | undefined,
  whole: number | null | undefined,
  { spaced = false, grouping = false }: { spaced?: boolean; grouping?: boolean } = {},
): string {
  if (!isCount(part)) return "";
  const separator = spaced ? " / " : "/";
  return `${formatNumber(part, { grouping })}${separator}${isCount(whole) ? formatNumber(whole, { grouping }) : MISSING}`;
}

/** The per-box rate as a decimal: 1 of 125 is "0.008" (3 decimals by default). */
export function formatRatioDecimal(
  part: number | null | undefined,
  whole: number | null | undefined,
  { decimals = 3 }: { decimals?: number } = {},
): string {
  return formatNumber(ratio(part, whole), { decimals });
}

/**
 * "3 / 625 (0.48%)": defects over gloves inspected with the rate. The
 * percentage keeps at most `maxDecimals` (default 2) and drops trailing
 * zeros, as the reports do: "11 / 1,000 (1.1%)", "0 / 1,000 (0%)". The
 * counts have thousands separators unless `grouping` is false. Without a
 * positive whole there is no rate: "3 / —".
 */
export function formatRate(
  part: number | null | undefined,
  whole: number | null | undefined,
  { maxDecimals = 2, grouping = true }: { maxDecimals?: number; grouping?: boolean } = {},
): string {
  const text = formatRatio(part, whole, { spaced: true, grouping });
  const value = ratio(part, whole);
  if (text === "" || value === null) return text;
  return `${text} (${formatNumber(toPercent(value), { maxDecimals, unit: "%" })})`;
}

/** The rate as a percentage number, rounded: 3 of 625 is 0.48. Null without a positive whole. */
export function ratePercent(
  part: number | null | undefined,
  whole: number | null | undefined,
  decimals = 2,
): number | null {
  const value = ratio(part, whole);
  return value === null ? null : roundTo(toPercent(value), decimals);
}
