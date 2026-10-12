// Steri-AI Cost's amounts (docs/AI.md, "Steri-AI Cost"): US dollars, as
// Anthropic bills, or ringgit at the price list's rate. Totals to the cent;
// per-unit averages and prices to their first figures that matter. Client-safe:
// the server components and the chart both use it.
import type { CostCurrency } from "@/lib/schemas/ai-usage";

/** The currency the view shows, and ringgit per dollar (null: dollars only). */
export type Money = { currency: CostCurrency; myrPerUsd: number | null };

export const USD: Money = { currency: "usd", myrPerUsd: null };

/** "total": tiles, rows, tables. "unit": per-unit averages and the price list. */
export type CostStyle = "total" | "unit";

function myrRate(money: Money): number | null {
  return money.currency === "myr" && money.myrPerUsd !== null ? money.myrPerUsd : null;
}

/** A dollar amount in the view's currency. */
export function inCurrency(usd: number, money: Money): number {
  const rate = myrRate(money);
  return rate === null ? usd : usd * rate;
}

function sign(money: Money): string {
  return myrRate(money) === null ? "$" : "RM ";
}

const formats = new Map<string, Intl.NumberFormat>();

/** en-US grouping (1,234.56), between `min` and `max` decimals. */
function decimals(value: number, min: number, max: number): string {
  const key = `${min}:${max}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    formats.set(key, format);
  }
  return format.format(value);
}

/**
 * "$1,234.56" or "RM 5,826.12". Totals have 2 decimals, and an amount under a
 * cent shows as "< $0.01". Units have 2 decimals from 1, up to 3 from 0.01 and
 * up to 4 from 0.0001 ("$0.125", "$0.0048", but "$0.01"), else "< $0.0001".
 */
export function formatCost(usd: number, money: Money, style: CostStyle = "total"): string {
  const value = inCurrency(usd, money);
  const prefix = sign(money);
  if (value <= 0) return `${prefix}0.00`;
  if (style === "total") return value < 0.01 ? `< ${prefix}0.01` : `${prefix}${decimals(value, 2, 2)}`;
  if (value >= 1) return `${prefix}${decimals(value, 2, 2)}`;
  if (value >= 0.01) return `${prefix}${decimals(value, 2, 3)}`;
  if (value >= 0.0001) return `${prefix}${decimals(value, 2, 4)}`;
  return `< ${prefix}0.0001`;
}

/** An amount already in the view's currency, with exactly `places` decimals: the chart's axis. */
export function formatAxisValue(value: number, money: Money, places: number): string {
  return `${sign(money)}${decimals(value, places, places)}`;
}

/** The price list's rate: "RM 4.72". */
export function formatMyrRate(myrPerUsd: number): string {
  return `RM ${decimals(myrPerUsd, 2, 4)}`;
}

/** "1 call", "214 calls", "1,284 photos and videos". */
export function countOf(count: number, one: string, many: string): string {
  return `${decimals(count, 0, 0)} ${count === 1 ? one : many}`;
}
