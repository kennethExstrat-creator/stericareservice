// Pure edits of the saved data, for Capture and the capture screen. Each
// takes the latest data (useDataUpdater's `current`) and returns the whole new
// data (CaptureProps.onChange), keeping every saved size, also sizes no longer
// ordered: their readings return with them (6.2 rule 4).
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
