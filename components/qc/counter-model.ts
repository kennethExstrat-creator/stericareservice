// Totals and the live accept/reject decision behind CounterTable, kept pure
// so they can be tested. The rule is ISO 2859-1 single sampling, the same as
// lib/aql's decide: accept with at most Ac defects, reject at Re or more.
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

/** Accept with at most Ac defects; reject at Re (Ac + 1) or more. */
export function decide(total: number, limits: AcceptanceLimits): "accept" | "reject" {
  return total <= limits.ac ? "accept" : "reject";
}

/**
 * The chip for a column: calc's status when given (it knows whether the
 * column is done), else the live decision from the limits, else not done.
 */
export function columnStatus(
  total: number,
  { limits, status }: { limits?: AcceptanceLimits | null; status?: Status },
): Status {
  if (status) return status;
  if (!limits) return "not_done";
  return decide(total, limits) === "accept" ? "pass" : "fail";
}
