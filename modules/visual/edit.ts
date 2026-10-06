// Pure edits behind Capture.tsx: each takes the module's whole data and
// returns the whole new value for onChange, leaving every other size as it
// was, ordered or not (MODULES.md section 10).
import type { Hand } from "@/modules/_framework";
import type { VisualDefect } from "./config";
import {
  emptyVisualHand,
  emptyVisualSize,
  type DefectClass,
  type OneOffDefect,
  type VisualCounts,
  type VisualData,
  type VisualSize,
} from "./schema";

/** Where a count goes: a size and class, and a hand when the template splits hands. */
export type DefectCell = { size: string; cls: DefectClass; hand?: Hand };

/** CounterTable row keys of one-off labels; defect codes never contain a colon. */
export const ONE_OFF_ROW_PREFIX = "unmapped:";

/** One-off labels compare without case or extra spaces: "faint print" is "Faint  print". */
export function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function oneOffRowKey(label: string): string {
  return `${ONE_OFF_ROW_PREFIX}${labelKey(label)}`;
}

function sizeOf(data: VisualData, size: string): VisualSize {
  return data.sizes[size] ?? emptyVisualSize();
}

function countsOf(entry: VisualSize, { cls, hand }: Pick<DefectCell, "cls" | "hand">): VisualCounts {
  return hand === undefined ? entry[cls] : (entry[hand] ?? emptyVisualHand())[cls];
}

function withSize(data: VisualData, size: string, entry: VisualSize): VisualData {
  return { ...data, sizes: { ...data.sizes, [size]: entry } };
}

function withCounts(data: VisualData, cell: DefectCell, change: (record: VisualCounts) => VisualCounts): VisualData {
  const entry = sizeOf(data, cell.size);
  const { counts, unmapped } = change(countsOf(entry, cell));
  if (cell.hand === undefined) return withSize(data, cell.size, { ...entry, [cell.cls]: { ...entry[cell.cls], counts, unmapped } });
  const hand = entry[cell.hand] ?? emptyVisualHand();
  return withSize(data, cell.size, { ...entry, [cell.hand]: { ...hand, [cell.cls]: { counts, unmapped } } });
}

export function readCount(data: VisualData, cell: DefectCell, code: string): number {
  return countsOf(sizeOf(data, cell.size), cell).counts[code] ?? 0;
}

/** A defect's count; 0 removes the key, since a defect never tapped was not found. */
export function setCount(data: VisualData, cell: DefectCell, code: string, count: number): VisualData {
  return withCounts(data, cell, (record) => {
    const counts = { ...record.counts };
    if (count > 0) counts[code] = count;
    else delete counts[code];
    return { ...record, counts };
  });
}

export function setInspected(data: VisualData, size: string, cls: DefectClass, inspected: number | null): VisualData {
  const entry = sizeOf(data, size);
  return withSize(data, size, { ...entry, [cls]: { ...entry[cls], inspected } });
}

/** The sampling plan's n for every given class of the size that has none yet. */
export function fillInspected(data: VisualData, size: string, classes: readonly DefectClass[], n: number): VisualData {
  let next = data;
  for (const cls of classes) {
    if (sizeOf(next, size)[cls].inspected === null) next = setInspected(next, size, cls, n);
  }
  return next;
}

export function readOneOff(data: VisualData, cell: DefectCell, label: string): { index: number; entry: OneOffDefect } | null {
  const key = labelKey(label);
  const list = countsOf(sizeOf(data, cell.size), cell).unmapped;
  const index = list.findIndex((entry) => labelKey(entry.label) === key);
  return index === -1 ? null : { index, entry: list[index] };
}

/** A one-off's count in one cell, added to that cell's list when it is not there yet. */
export function setOneOff(data: VisualData, cell: DefectCell, label: string, count: number): VisualData {
  return withCounts(data, cell, (record) => {
    const key = labelKey(label);
    const index = record.unmapped.findIndex((entry) => labelKey(entry.label) === key);
    const unmapped =
      index === -1
        ? [...record.unmapped, { label: label.trim(), count }]
        : record.unmapped.map((entry, at) => (at === index ? { ...entry, count } : entry));
    return { ...record, unmapped };
  });
}

/**
 * Adds a one-off label (count 0) to a cell so its row appears in the class;
 * the inspector then counts it like any other row. Nothing changes when the
 * label is already in the class's list or a one-off row of the class.
 */
export function addOneOff(
  data: VisualData,
  cell: DefectCell,
  label: string,
  defects: readonly VisualDefect[],
  sizes: readonly string[],
  split: boolean,
): VisualData {
  const key = labelKey(label);
  if (key === "") return data;
  if (defects.some((defect) => labelKey(defect.label) === key)) return data;
  if (oneOffLabels(data, sizes, cell.cls, split).some((existing) => labelKey(existing) === key)) return data;
  return setOneOff(data, cell, label, 0);
}

/**
 * Codes with defects saved in a class that the class's list lacks, over the
 * ordered sizes (and hands): calc counts them, so the screen shows them as rows too.
 */
export function unlistedCodes(
  data: VisualData,
  sizes: readonly string[],
  cls: DefectClass,
  split: boolean,
  listed: ReadonlySet<string>,
): string[] {
  const codes = new Set<string>();
  for (const size of sizes) {
    const entry = data.sizes[size];
    if (!entry) continue;
    for (const record of split ? [entry.R?.[cls], entry.L?.[cls]] : [entry[cls]]) {
      for (const [code, count] of Object.entries(record?.counts ?? {})) {
        if (count > 0 && !listed.has(code)) codes.add(code);
      }
    }
  }
  return [...codes];
}

/** A class's one-off labels saved for any ordered size (and hand), first spelling kept, in order of entry. */
export function oneOffLabels(data: VisualData, sizes: readonly string[], cls: DefectClass, split: boolean): string[] {
  const seen = new Map<string, string>();
  for (const size of sizes) {
    const entry = data.sizes[size];
    if (!entry) continue;
    const records = split ? [entry.R?.[cls], entry.L?.[cls]] : [entry[cls]];
    for (const record of records) {
      for (const { label } of record?.unmapped ?? []) {
        const key = labelKey(label);
        if (!seen.has(key)) seen.set(key, label.trim());
      }
    }
  }
  return [...seen.values()];
}
