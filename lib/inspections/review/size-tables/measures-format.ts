// What the review's measure and count tables share (layout A, Kenneth, 27
// October 2026): dimensions, weight, force at break, tensile, dye leak, the
// order, the sampling plan and carton sampling. A row's label with its unit
// in brackets ("Length (mm)"), a spec placed once under the label when every
// size has the same one ("≥ 240") and in each size's cell when they differ
// ("80 ± 10", "95 ± 10"), a cell's tone from the module's own verdicts and
// issues, and no table while nothing is entered. Pure. Each adapter prints
// its numbers as its module's summary does.
//
// Only types come from ../size-table: it imports the adapters, so a value
// imported back from it would run before it is defined when an adapter is
// loaded first.
import { formatNumber, formatSpec, hasLimit, type NumberFormat } from "@/lib/format";
import type { Spec } from "@/lib/stats";
import type { ValidationIssue } from "@/modules/_framework";
import type { SizeTable, SizeTableCell, SizeTableRow, SizeTableTone } from "../size-table";

/** Between a note's parts: "95 ± 10 · Passed by the Inspector". */
const NOTE_SEPARATOR = " · ";

/**
 * "Length (mm)", "Average (g)": the label in the template's wording with the
 * unit in brackets, unless the label names it already ("Tensile Strength
 * (Average) (MPa)", "Weight (g)").
 */
export function labelWithUnit(label: string, unit: string): string {
  const unitInBrackets = `(${unit})`;
  return label.includes(unitInBrackets) ? label : `${label} ${unitInBrackets}`;
}

/** A spec as the module prints it ("≥ 240", "95 ± 10", "≥ 14.00"); null without a limit (none, or NA). */
export function specText(spec: Spec | null | undefined, decimals?: number): string | null {
  return hasLimit(spec) ? formatSpec(spec, { decimals }) : null;
}

export type PlacedSpecs = {
  /** The spec every size shares, shown once under the label. */
  spec?: string;
  /** A size's own spec, for its cell's note, where the sizes differ. */
  note: (size: string) => string | undefined;
};

/**
 * Where a row's specs go: once under the label when every size has the same
 * one, else each size's own in its cell. A size without a limit (none, or
 * NA) has no note; with none at all the row has no spec. `undefined` is a
 * size the module computed nothing for, which neither shares a spec nor
 * breaks one shared.
 */
export function placeSpecs(sizes: readonly string[], specOf: (size: string) => string | null | undefined): PlacedSpecs {
  const specs = new Map(sizes.map((size) => [size, specOf(size)]));
  const known = [...specs.values()].filter((spec) => spec !== undefined);
  const first = known[0];
  if (typeof first === "string" && known.every((spec) => spec === first)) return { spec: first, note: () => undefined };
  return { note: (size) => specs.get(size) ?? undefined };
}

/** A number as the module prints it ("2.90", "6.537"); null, a dash, without one. */
export function numberText(value: number | null | undefined, format: NumberFormat = {}): string | null {
  const text = formatNumber(value, format);
  return text === "" ? null : text;
}

/** A count with thousands separators ("2,900"); null, a dash, without one. */
export function countText(value: number | null | undefined): string | null {
  return numberText(value, { grouping: true });
}

/** "9 of 13 Readings": a size still waiting for some of its readings. */
export function readingsNote(entered: number, needed: number): string {
  return `${formatNumber(entered, { grouping: true })} of ${formatNumber(needed, { grouping: true })} Readings`;
}

/** A size whose sampling plan gives the test no gloves. */
export const NO_GLOVES_NOTE = "No Gloves Planned";

/** "95 ± 10 · Passed by the Inspector": the parts that are there; undefined with none. */
export function joinNote(...parts: readonly (string | null | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => typeof part === "string" && part.trim() !== "");
  return present.length === 0 ? undefined : present.join(NOTE_SEPARATOR);
}

/** True for an issue about a size's cell: its path starts `["sizes", size, ...path]`. */
export function onCell(issue: Pick<ValidationIssue, "path">, size: string, ...path: readonly (string | number)[]): boolean {
  return ["sizes", size, ...path].every((segment, index) => issue.path[index] === segment);
}

/** The cell's tone from the module's issues that match: fail for an error, warn for a warning, none without one. */
export function issueTone(
  issues: readonly ValidationIssue[],
  matches: (issue: ValidationIssue) => boolean,
): SizeTableTone | undefined {
  const found = issues.filter(matches);
  if (found.some((issue) => issue.level === "error")) return "fail";
  return found.length > 0 ? "warn" : undefined;
}

/** The stronger of the tones: fail over warn. */
export function worstTone(...tones: readonly (SizeTableTone | undefined)[]): SizeTableTone | undefined {
  if (tones.includes("fail")) return "fail";
  return tones.includes("warn") ? "warn" : undefined;
}

/** A cell with its note and tone only where it has them. */
export function cell(text: string | null, extra: { note?: string | null; tone?: SizeTableTone } = {}): SizeTableCell {
  return {
    text,
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.tone ? { tone: extra.tone } : {}),
  };
}

/** A row: one cell per ordered size, in the template's order, and its shared spec where there is one. */
export function sizeRow(
  key: string,
  label: string,
  sizes: readonly string[],
  cellOf: (size: string) => SizeTableCell,
  spec?: string | null,
): SizeTableRow {
  return { key, label, ...(spec ? { spec } : {}), cells: sizes.map((size) => cellOf(size)) };
}

/**
 * The table, or null while nothing is entered, so the review shows the
 * module's summary instead. `entered` says whether the module holds anything
 * for a size, a reading still short of its median included; by default,
 * whether any cell holds a value.
 */
export function tableOf(rows: readonly SizeTableRow[], entered?: boolean): SizeTable | null {
  const shown = entered ?? rows.some((row) => row.cells.some((entry) => entry.text !== null));
  return shown && rows.length > 0 ? { rows: [...rows] } : null;
}
