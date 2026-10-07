// Totals, the live accept/reject chip and the spoken summary behind
// CounterTable, kept pure so they can be tested. The chip is a display: the
// result that counts is calc's, from lib/aql's decide (which also knows a
// sample short of n is incomplete). Not exported from @/components/qc, so a
// calc never picks it up by mistake.
import type { Status } from "@/lib/design/status";
import type { AcceptanceLimits } from "@/lib/format";

export type CounterHand = "R" | "L";

/** One stepper: a row (defect or location) in a column (size or box), for one hand with a split. */
export type CounterCell = { readonly row: string; readonly column: string; readonly hand?: CounterHand };

/** Reads a stored count; null or undefined (nothing counted yet) counts as 0. */
export type CountReader = (cell: CounterCell) => number | null | undefined;

/** A stored count as a whole number for the stepper: missing, negative or broken values are 0. */
export function countOf(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A column's total over every row and every recorded hand (shown or not). */
export function columnTotal(
  rows: readonly { readonly key: string }[],
  column: string,
  hands: readonly CounterHand[] | undefined,
  read: CountReader,
): number {
  const sides: readonly (CounterHand | undefined)[] = hands && hands.length > 0 ? hands : [undefined];
  let total = 0;
  for (const row of rows) {
    for (const hand of sides) total += countOf(read(hand ? { row: row.key, column, hand } : { row: row.key, column }));
  }
  return total;
}

/**
 * The chip for one column of one table. With limits it is the live decision,
 * accept up to Ac and reject from Re (ISO 2859-1 single sampling), so it
 * changes with the tap that changes the total and never shows a verdict from
 * before it. calc's status wins only when it says the column is not done
 * (calc knows what is missing). Without limits: calc's status, else not done.
 */
export function columnStatus(
  total: number,
  { limits, status }: { limits?: AcceptanceLimits | null; status?: Status },
): Status {
  if (status === "not_done") return "not_done";
  if (limits) return total <= limits.ac ? "pass" : "fail";
  return status ?? "not_done";
}

/**
 * What CounterTable says after a tap, built from the props rendered with the
 * new count, so it matches the chip on screen: "3. Size M: total 8, Reject."
 */
export function counterAnnouncement({
  count,
  column,
  total,
  verdict,
}: {
  /** The tapped cell's new count. */
  count: number;
  /** The column's accessible name, e.g. "Size M". */
  column: string;
  total: number;
  /** The chip's words, or null when it shows no verdict. */
  verdict: string | null;
}): string {
  return `${count}. ${column}: total ${total}${verdict ? `, ${verdict}` : ""}.`;
}

/** Where the focus goes when a row's remove button goes with its row. */
export type RemovalFocus =
  | { readonly to: "opener" }
  | { readonly to: "row"; readonly index: number }
  | { readonly to: "table" };

/**
 * Where removing row `index` of `rowCount` (counted before the removal)
 * leaves the focus: "Other Defect" while its opener is on screen; else (its
 * form is open, or the table offers none) the row that takes the removed
 * one's place, or the one before it for the last row; else the table itself.
 * Never the page, where a keyboard or switch user would lose their place.
 */
export function removalFocus(index: number, rowCount: number, hasOpener: boolean): RemovalFocus {
  if (hasOpener) return { to: "opener" };
  if (index + 1 < rowCount) return { to: "row", index: index + 1 };
  if (index > 0) return { to: "row", index: index - 1 };
  return { to: "table" };
}

/**
 * CounterTable's widths in CSS px, as its classes set them: the label column
 * (w-64) and each value column (w-32, touch:w-40), plus the frame's borders.
 */
export const COUNTER_WIDTHS = { label: 256, value: 128, valueTouch: 160, frame: 2 } as const;

/** The width a CounterTable needs to show `valueColumns` value columns side by side. */
export function counterTableWidth(valueColumns: number, coarse: boolean): number {
  const value = coarse ? COUNTER_WIDTHS.valueTouch : COUNTER_WIDTHS.value;
  return COUNTER_WIDTHS.label + valueColumns * value + COUNTER_WIDTHS.frame;
}
