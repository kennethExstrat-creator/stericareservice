// Parsing and formatting for numeric entry (BUILD_SPEC 6.2 rule 1: numeric
// cells accept numbers only; "2 42" is rejected, never stored as text).
import { roundTo } from "./statistics";

export type ParseDecimalResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

const PLAIN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DECIMAL_COMMA = /^-?\d+,(\d+)$/;

/**
 * Reads one decimal number. Blank is a valid "no value" (null). A single
 * comma is read as a decimal point, except before exactly three digits,
 * where it could be a thousands separator and is rejected instead.
 */
export function parseDecimal(raw: string): ParseDecimalResult {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  if (PLAIN.test(text)) return { ok: true, value: Number(text) };

  const comma = DECIMAL_COMMA.exec(text);
  if (comma) {
    if (comma[1].length === 3) {
      return { ok: false, error: "Use a point for decimals, e.g. 1.234." };
    }
    return { ok: true, value: Number(text.replace(",", ".")) };
  }

  if (/^-?[\d.,]+(?:\s+[\d.,]+)+$/.test(text)) {
    return { ok: false, error: "One number per cell: remove the space, e.g. 2.42." };
  }
  return { ok: false, error: "Numbers only, e.g. 2.42." };
}

/** Range check for a parsed value; null when it fits. */
export function rangeError(value: number, { min, max }: { min?: number; max?: number }): string | null {
  if (min !== undefined && value < min) return `Must be ${formatDecimal(min)} or more.`;
  if (max !== undefined && value > max) return `Must be ${formatDecimal(max)} or less.`;
  return null;
}

/** Blank for null; fixed decimals when given (rounded half away from zero). */
export function formatDecimal(value: number | null, decimals?: number): string {
  if (value === null) return "";
  if (decimals === undefined) return String(value);
  return roundTo(value, decimals).toFixed(decimals);
}
