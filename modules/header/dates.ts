// Manufacturing and expiry dates at the template's precision: a full date,
// or month and year (SAFEDON_EG prints "Feb-25"), stored as the first of the
// month. Dates are ISO text, so comparing the text compares the dates and no
// Date object (or time zone) is involved.
import type { MfgExpiryPrecision } from "./config";

/** "2025-04-01", or "2025-04" at month precision: what the report prints and what is compared. */
export function datePart(date: string, precision: MfgExpiryPrecision): string {
  return precision === "month" ? date.slice(0, 7) : date;
}

/** The stored value of a month picked at month precision: its first day, "2025-02-01". */
export function monthDate(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Year and month (1 to 12) of a stored `YYYY-MM-DD` date. */
export function yearMonth(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}
