// Words and numbers as the report prints them: dates in full ("23 October
// 2026", "Friday, 23 October 2026"), counts with thousands separators,
// shares, ranges ("243 to 244 mm"), lists ("S, M, L and XL") and the aged
// gloves' ageing ("70 °C · 7 days"). Pure and locale-free apart from the
// month and day names, which are the same on the server and in the browser,
// so the Report page's preview and the printed pages read alike.
import { formatCount, formatNumber, withUnit, type NumberFormat } from "@/lib/format";

// Calendar dates (the inspection day in Malaysia), formatted in UTC so they never shift.
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

function utcDay(iso: string): Date | null {
  const match = ISO_DAY.exec(iso);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `2026-10-23` as "23 October 2026"; a month (`2026-10`, a date kept at
 * month precision) as "October 2026". Anything else is shown as it is; null
 * stays null.
 */
export function longDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const month = ISO_MONTH.exec(iso);
  if (month) return MONTH_YEAR.format(new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)));
  const day = utcDay(iso);
  return day ? LONG_DATE.format(day) : iso;
}

/** `2026-10-23` as "Friday, 23 October 2026": the day the inspection was made. */
export function weekdayDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = utcDay(iso);
  // Composed, so the comma is the same whatever the browser's locale data.
  return day ? `${WEEKDAY.format(day)}, ${LONG_DATE.format(day)}` : longDate(iso);
}

/** "S", "S and M", "S, M, L and XL": a list inside a sentence. */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A count with its noun: "1 carton", "4,551 cartons". */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/**
 * The lowest and highest of some values, printed as one ("6.537 N") or as a
 * range ("6.4 to 6.6 N", or "87–90%" with `dash`, where two ranges share a
 * line); null when there are none.
 */
export function rangeText(values: readonly (number | null | undefined)[], format: NumberFormat & { dash?: boolean } = {}): string | null {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (known.length === 0) return null;
  const { dash = false, unit, ...rest } = format;
  const low = formatNumber(Math.min(...known), rest);
  const high = formatNumber(Math.max(...known), rest);
  return withUnit(low === high ? low : dash ? `${low}–${high}` : `${low} to ${high}`, unit);
}

/**
 * Shares of a whole in percent, one decimal each, adding up to exactly 100
 * (largest remainder): 1,120 / 2,081 / 1,100 / 250 cartons are 24.6, 45.7,
 * 24.2 and 5.5. Zeros everywhere when the whole is nothing.
 */
export function sharesOf(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const tenths = values.map((value) => (value / total) * 1000);
  const floors = tenths.map(Math.floor);
  let left = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = tenths.map((value, index) => ({ index, remainder: value - floors[index] })).sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors.map((value) => value / 10);
}

/** "24.6%": a share as the report prints it, one decimal; 100 as "100%". */
export function shareText(share: number): string {
  return formatNumber(share, { maxDecimals: 1, unit: "%" });
}

/**
 * The aged gloves' ageing, stated wherever the report shows them (Kenneth,
 * 27 October 2026; TG35 page 7 and EN 455-2's accelerated ageing): 7 days at
 * 70 °C. The packing check records no ageing of its own, so the report says
 * it from here, in the three phrasings below.
 */
export const AGEING_CONDITION = { celsius: 70, days: 7 } as const;

const AGEING_DEGREES = `${AGEING_CONDITION.celsius} °C`;

/** "70 °C · 7 days": under "Aged Gloves" in the packing chart, before their box count. */
export const AGEING_LINE = `${AGEING_DEGREES} · ${counted(AGEING_CONDITION.days, "day")}`;

/** "70 °C, 7 Days": in the aged gloves' table heading, "Box-Aged Gloves (70 °C, 7 Days)", in Title Case as headings are. */
export const AGEING_HEADING = `${AGEING_DEGREES}, ${counted(AGEING_CONDITION.days, "Day")}`;

/** "Aged at 70 °C for 7 days": in a sentence, the aged gloves' photo note. */
export const AGEING_SENTENCE = `Aged at ${AGEING_DEGREES} for ${counted(AGEING_CONDITION.days, "day")}`;

/** An AQL as the reports head it: "AQL 1.5", "AQL 4.0", "AQL 0.0", "AQL 0.65". */
export function aqlText(aql: number): string {
  const decimals = Math.max(1, (String(aql).split(".")[1] ?? "").length);
  return `AQL ${formatNumber(aql, { decimals })}`;
}
