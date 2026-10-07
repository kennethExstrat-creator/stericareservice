// Manufacturing and expiry dates at the template's precision: a full date,
// or month and year (SAFEDON_EG prints "Feb-25"), stored as the first of the
// month. Dates are ISO text, so comparing the text compares the dates and no
// Date object (or time zone) is involved. Only the words on screen (the
// summary, the warnings) show a date the way the rest of the app does,
// "19 Feb 2025"; the data, the computed values and the export keep ISO.
import type { MfgExpiryPrecision } from "./config";

/** "2025-04-01", or "2025-04" at month precision: what the report prints and what is compared. */
export function datePart(date: string, precision: MfgExpiryPrecision): string {
  return precision === "month" ? date.slice(0, 7) : date;
}

// British order, short month, as lib/inspections' formatInspectionDate shows
// a day on the list and the review (a module may not import it). Calendar
// dates, so they are formatted in UTC and never shift.
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2025-02-19` as `19 Feb 2025`, as the app shows a day elsewhere. Anything that is not a calendar date is shown as it is. */
export function formatDay(date: string): string {
  const match = ISO_DATE.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return DAY.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** A stored date at the template's precision, in words: `1 Apr 2025`, or `Apr 2025` for month and year. */
export function formatDate(date: string, precision: MfgExpiryPrecision): string {
  if (precision !== "month") return formatDay(date);
  const match = ISO_DATE.exec(date);
  if (!match) return datePart(date, precision);
  const [, year, month] = match;
  return MONTH.format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
}

/** The stored value of a month picked at month precision: its first day, "2025-02-01". */
export function monthDate(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Year and month (1 to 12) of a stored `YYYY-MM-DD` date. */
export function yearMonth(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}
