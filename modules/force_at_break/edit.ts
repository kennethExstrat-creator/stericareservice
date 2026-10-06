// Pure edits of the saved data, for Capture and the capture screen. Each
// returns the whole new data (CaptureProps.onChange) and keeps every saved
// size, also sizes no longer ordered: their readings return with them
// (6.2 rule 4).
import { emptyForceAtBreakSize, type ForceAtBreakData } from "./schema";

type Readings = readonly (number | null)[];

/** A size's readings replaced; blanks at the end are dropped. */
export function withReadings(data: ForceAtBreakData, size: string, values: Readings): ForceAtBreakData {
  const entry = data.sizes[size] ?? emptyForceAtBreakSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, values: withoutTrailingBlanks(values) } } };
}

/**
 * The grid's column of `rows` cells written over the size's readings. A
 * reading past the grid stays saved, and calc reports it, until the
 * inspector clears it: editing a cell never drops it silently.
 */
export function withGridColumn(data: ForceAtBreakData, size: string, column: Readings, rows: number): ForceAtBreakData {
  const saved = data.sizes[size]?.values ?? [];
  const cells = Array.from({ length: rows }, (_, index) => column[index] ?? null);
  return withReadings(data, size, [...cells, ...saved.slice(rows)]);
}

/** Saved readings past the n gloves tested, with their positions. */
export function readingsBeyond(values: Readings, n: number): { index: number; value: number }[] {
  return values.flatMap((value, index) => (index >= n && value !== null ? [{ index, value }] : []));
}

/** The size's readings past the n gloves tested, removed. */
export function withoutReadingsBeyond(data: ForceAtBreakData, size: string, n: number): ForceAtBreakData {
  return withReadings(data, size, (data.sizes[size]?.values ?? []).slice(0, n));
}

/**
 * The lab report the capture screen queued for this module: the id
 * `enqueueFile` returns, which becomes the inspection_files row id. Null
 * detaches it.
 */
export function withLabReport(data: ForceAtBreakData, fileId: string | null): ForceAtBreakData {
  return { ...data, labReport: fileId };
}

function withoutTrailingBlanks(values: Readings): (number | null)[] {
  let end = values.length;
  while (end > 0 && values[end - 1] === null) end -= 1;
  return values.slice(0, end);
}
