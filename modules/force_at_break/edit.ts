// Pure edits of the saved data, for Capture and the capture screen. Each
// takes the latest data (useDataUpdater's `current`) and returns the whole new
// data (CaptureProps.onChange), keeping every saved size, also sizes no longer
// ordered: their readings return with them (6.2 rule 4).
import { parseDecimal } from "@/lib/stats";
import { emptyForceAtBreakSize, type ForceAtBreakData } from "./schema";

type Readings = readonly (number | null)[];

/** A size's readings replaced; blanks at the end are dropped. */
export function withReadings(data: ForceAtBreakData, size: string, values: Readings): ForceAtBreakData {
  const entry = data.sizes[size] ?? emptyForceAtBreakSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, values: withoutTrailingBlanks(values) } } };
}

/**
 * The grid's edit written over the size's latest readings. MeasurementGrid
 * hands back its whole column of `rows` cells, built from the readings it was
 * rendered with (`shown`): only the cells that differ from them are the edit,
 * so a change the screen has not rendered yet (an earlier cell, a paste) is
 * kept. A reading past the grid stays saved, and calc reports it, until the
 * inspector clears it: editing a cell never drops it silently.
 */
export function withGridEdits(
  data: ForceAtBreakData,
  size: string,
  shown: Readings,
  column: Readings,
  rows: number,
): ForceAtBreakData {
  const values = [...(data.sizes[size]?.values ?? [])];
  let edited = false;
  for (let index = 0; index < rows; index += 1) {
    const next = column[index] ?? null;
    if (next === (shown[index] ?? null)) continue;
    while (values.length < index) values.push(null);
    values[index] = next;
    edited = true;
  }
  return edited ? withReadings(data, size, values) : data;
}

/**
 * The part of a pasted column that runs past the grid's last row, pasted
 * into row `from` of a grid of `rows`: MeasurementGrid stores a column only
 * as far as its rows, so the lab's 13 readings pasted into a plan of 10 would
 * lose 3. Each line's first value, read as a number; text is never stored
 * (null). Empty when the paste fits, or is one value or one row.
 */
export function pastedPastGrid(text: string, from: number, rows: number): (number | null)[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length < 2) return [];
  return lines.slice(Math.max(0, rows - from)).map((line) => {
    const read = parseDecimal(line.split("\t")[0]);
    return read.ok ? read.value : null;
  });
}

/**
 * Readings written from position `start` on, over the size's latest
 * readings: the run of a pasted column past the grid, kept as readings past
 * the gloves tested, so calc reports them instead of the paste dropping them.
 * The same data back when nothing changes.
 */
export function withReadingsFrom(data: ForceAtBreakData, size: string, start: number, values: Readings): ForceAtBreakData {
  const saved = data.sizes[size]?.values ?? [];
  if (values.every((value, offset) => (saved[start + offset] ?? null) === value)) return data;
  const next = [...saved];
  values.forEach((value, offset) => {
    while (next.length < start + offset) next.push(null);
    next[start + offset] = value;
  });
  return withReadings(data, size, next);
}

/** Saved readings past the n gloves tested, with their positions. */
export function readingsBeyond(values: Readings, n: number): { index: number; value: number }[] {
  return values.flatMap((value, index) => (index >= n && value !== null ? [{ index, value }] : []));
}

/** The size's readings past the n gloves tested, removed. */
export function withoutReadingsBeyond(data: ForceAtBreakData, size: string, n: number): ForceAtBreakData {
  const values = data.sizes[size]?.values ?? [];
  return readingsBeyond(values, n).length === 0 ? data : withReadings(data, size, values.slice(0, n));
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
