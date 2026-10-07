// What the capture screen reads from and writes to the saved data, kept pure
// so it is tested without a browser: a size's readings as grid columns, the
// grid's changed cells as readings, the data with them written in, the data
// without the gloves past the grid's rows, calc's figures for the grid's
// footer and the path of each cell. Writes go through useDataUpdater
// (docs/CAPTURE_KIT.md), so each starts from the latest data, never from the
// data the grid rendered with.
import type { MeasureSummary, MeasurementCell, MeasurementChange } from "@/components/qc";
import type { DimensionsComputed } from "./calc";
import type { Measure } from "./config";
import { emptyGlove, type DimensionGlove, type DimensionsData } from "./schema";

/** Readings per measure, one per glove row: MeasurementGrid's values. */
export type GridColumns = Readonly<Record<string, readonly (number | null)[]>>;

/** One reading to store: glove `row` (0 is glove 1), one measure. */
export type ReadingChange = { readonly row: number; readonly measure: Measure; readonly value: number | null };

/** The size's readings as columns of `rows` gloves, null where nothing is entered. */
export function gridColumns(data: DimensionsData, size: string, measures: readonly Measure[], rows: number): GridColumns {
  const gloves = data.sizes[size]?.gloves ?? [];
  return Object.fromEntries(
    measures.map((measure) => [measure, Array.from({ length: rows }, (_, row) => gloves[row]?.[measure] ?? null)]),
  );
}

/**
 * The grid's changed cells (onCellsChange) as readings of the measures on
 * screen; a cell of any other key is not a reading and is left out.
 */
export function readingChanges(changes: readonly MeasurementChange[], measures: readonly Measure[]): ReadingChange[] {
  return changes.flatMap(({ row, measure: key, value }) => {
    const measure = measures.find((candidate) => candidate === key);
    return measure === undefined ? [] : [{ row, measure, value }];
  });
}

/**
 * The whole data with the size's changed readings written in, built on
 * `current`. Every other size is kept, ordered or not (6.2 rule 4: its data
 * returns if the size is ordered again), and so is every other glove and
 * measure: gloves past the grid's rows (the sampling plan may grow again) and
 * measures the template does not show. Empty gloves at the end are dropped.
 * Returns `current` itself when nothing changes, so no save follows.
 */
export function withReadings(current: DimensionsData, size: string, changes: readonly ReadingChange[]): DimensionsData {
  const entry = current.sizes[size];
  const saved = entry?.gloves ?? [];
  const pending = changes.filter(({ row, measure, value }) => (saved[row]?.[measure] ?? null) !== value);
  if (pending.length === 0) return current;
  const gloves = [...saved];
  for (const { row, measure, value } of pending) {
    while (gloves.length <= row) gloves.push(emptyGlove());
    gloves[row] = { ...gloves[row], [measure]: value };
  }
  while (gloves.length > 0 && isEmpty(gloves[gloves.length - 1])) gloves.pop();
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, gloves } } };
}

/**
 * The whole data with the size's gloves past `rows` removed, built on
 * `current`: the readings calc says are not counted (dimension_beyond_sample),
 * which the grid has no row for, on every measure. Empty gloves at the end go
 * too. Returns `current` itself when there are none.
 */
export function withoutGlovesPast(current: DimensionsData, size: string, rows: number): DimensionsData {
  const entry = current.sizes[size];
  if (!entry || entry.gloves.length <= rows) return current;
  const gloves = entry.gloves.slice(0, rows);
  while (gloves.length > 0 && isEmpty(gloves[gloves.length - 1])) gloves.pop();
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, gloves } } };
}

function isEmpty(glove: DimensionGlove): boolean {
  return Object.values(glove).every((value) => value === null);
}

/**
 * calc's figures for one column of the size's grid, so the footer shows the
 * statistic, count and verdict the size's result is made of. Undefined while
 * calc has none for it (no evaluation yet, or a module calc could not run):
 * the grid then summarises its cells itself.
 */
export function measureSummary(
  computed: Partial<DimensionsComputed> | undefined,
  size: string,
  measure: Measure,
): MeasureSummary | undefined {
  const statistic = computed?.statistic?.[size]?.[measure];
  const outcome = computed?.measureResult?.[size]?.[measure];
  if (statistic === undefined || outcome === undefined) return undefined;
  return { statistic, outcome, count: computed?.count?.[size]?.[measure] };
}

/** The data path of a grid cell, as calc's issues point at it: `["sizes", "M", "gloves", 3, "width"]`. */
export function cellPath(size: string, { row, measure }: MeasurementCell): ["sizes", string, "gloves", number, string] {
  return ["sizes", size, "gloves", row, measure];
}

/** The size heading in the template's wording: "Dimension - Size {size}". */
export function sizeHeading(template: string, size: string): string {
  return template.replaceAll("{size}", size);
}
