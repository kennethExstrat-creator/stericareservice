// What the count tables share (watertight, visual, labelling and the two
// dispensing checks): a found list as the module summaries write it, a limit
// every size shares lifted under the row's label, and a cell's tone from the
// module's own verdict and the issues it raises at that cell's fields. The
// tables print and mark what calc decided; nothing here judges a value.
import type { ValidationIssue } from "@/lib/validation/issues";
import type { SizeTable, SizeTableCell, SizeTableRow, SizeTableTone } from "../size-table";

/** A found list with nothing in it, for a size that was inspected. */
const NONE = "None";

/** "Palm 3", "Ring mark 2": an item found, as the summaries list it, its name then its count. */
export function countedItem(name: string, count: number): string {
  return `${name} ${count}`;
}

/** A cell with only the parts it has: no `note` or `tone` key when it has none. */
export function cellOf(text: string | null, { note, tone }: { note?: string | null; tone?: SizeTableTone | null } = {}): SizeTableCell {
  return { text, ...(note ? { note } : {}), ...(tone ? { tone } : {}) };
}

/** Red for the module's own fail at the cell, else amber for something to check, else none. */
export function toneOf(fail: boolean, warn: boolean): SizeTableTone | null {
  return fail ? "fail" : warn ? "warn" : null;
}

/** A cell made amber, unless it is red already. */
export function withWarning(cell: SizeTableCell, warn: boolean): SizeTableCell {
  return warn && !cell.tone ? { ...cell, tone: "warn" } : cell;
}

/** One segment of an issue path to match: a key, an index, or null for whatever is there (any box). */
export type PathPattern = readonly (string | number | null)[];

/**
 * True when one of the issues sits at, or under, a path the patterns give:
 * ["sizes", "M", "tested"] matches the issue on that field, and
 * ["sizes", "M", "boxes", null, "boxNo"] the one on any box's number.
 */
export function hasIssueAt(issues: readonly Pick<ValidationIssue, "path">[], ...patterns: PathPattern[]): boolean {
  return issues.some(({ path }) =>
    patterns.some(
      (pattern) => pattern.length <= path.length && pattern.every((segment, index) => segment === null || path[index] === segment),
    ),
  );
}

/**
 * What a size found, as the summaries list it: the items in the template's
 * order and wording first; those it does not list (an inspector's one-off
 * label, a code the template lacks) after them on the second line, amber for
 * an admin to map; with only those, they are the text, amber. Nothing found
 * reads "None" once the size is recorded, else nothing yet (—).
 */
export function foundCell(listed: readonly string[], unlisted: readonly string[], { recorded }: { recorded: boolean }): SizeTableCell {
  if (listed.length === 0 && unlisted.length === 0) return { text: recorded ? NONE : null };
  if (unlisted.length === 0) return { text: listed.join(", ") };
  if (listed.length === 0) return { text: unlisted.join(", "), tone: "warn" };
  return { text: listed.join(", "), note: unlisted.join(", "), tone: "warn" };
}

/** The text every size has, the same; null when a size has none or another one. */
export function sharedText(texts: readonly (string | null)[]): string | null {
  const first = texts[0] ?? null;
  return first !== null && texts.every((text) => text === first) ? first : null;
}

/**
 * A row whose sizes each have a limit ("Limit 14 / 15"): the limit under the
 * label when every size has the same one ("Limit 0 / 1" for critical), else
 * each size's own on its cell's second line, which these cells keep free.
 */
export function rowWithLimits(
  row: Omit<SizeTableRow, "spec">,
  limits: readonly (string | null)[],
): SizeTableRow {
  const shared = sharedText(limits);
  if (shared !== null) return { ...row, spec: shared };
  return {
    ...row,
    cells: row.cells.map((cell, index) => {
      const limit = limits[index] ?? null;
      return limit === null ? cell : { ...cell, note: limit };
    }),
  };
}

/** The table, or null when it has nothing to show: no rows, or not one value in any of them. */
export function tableOf(rows: readonly SizeTableRow[]): SizeTable | null {
  return rows.some((row) => row.cells.some((cell) => cell.text !== null)) ? { rows: [...rows] } : null;
}

/** True for a plain object. A module that could not be calculated computed `{}`: no `sizes` to read, so no table. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
