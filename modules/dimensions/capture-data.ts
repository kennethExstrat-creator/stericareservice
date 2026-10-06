// What the capture screen reads from and writes to the saved data, kept pure
// so it is tested without a browser: a size's readings as grid columns, and
// the whole data back with one size's columns written in (MODULES.md 10:
// onChange takes the whole value, sizes no longer ordered included).
import type { Measure } from "./config";
import { emptyGlove, type DimensionGlove, type DimensionsData } from "./schema";

/** Readings per measure, one per glove row: MeasurementGrid's values. */
export type GridColumns = Readonly<Record<string, readonly (number | null)[]>>;

/** The size's readings as columns of `rows` gloves, null where nothing is entered. */
export function gridColumns(data: DimensionsData, size: string, measures: readonly Measure[], rows: number): GridColumns {
  const gloves = data.sizes[size]?.gloves ?? [];
  return Object.fromEntries(
    measures.map((measure) => [measure, Array.from({ length: rows }, (_, row) => gloves[row]?.[measure] ?? null)]),
  );
}

/**
 * The whole data with one size's grid written in. Every other size is kept,
 * ordered or not (6.2 rule 4: its data returns if the size is ordered again);
 * gloves past the grid's rows keep what was saved (the sampling plan may grow
 * again); measures the grid does not show are kept; empty gloves at the end
 * are dropped.
 */
export function withGridColumns(
  data: DimensionsData,
  size: string,
  columns: GridColumns,
  measures: readonly Measure[],
  rows: number,
): DimensionsData {
  const saved = data.sizes[size]?.gloves ?? [];
  const gloves = Array.from({ length: Math.max(saved.length, rows) }, (_, row): DimensionGlove => {
    const glove = saved[row] ?? emptyGlove();
    if (row >= rows) return glove;
    const written = measures.filter((measure) => columns[measure] !== undefined);
    return { ...glove, ...Object.fromEntries(written.map((measure) => [measure, columns[measure][row] ?? null])) };
  });
  while (gloves.length > 0 && isEmpty(gloves[gloves.length - 1])) gloves.pop();
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], gloves } } };
}

function isEmpty(glove: DimensionGlove): boolean {
  return Object.values(glove).every((value) => value === null);
}

/**
 * The data path of the grid's `index`th cell, as calc's issues point at it:
 * MeasurementGrid lays its cells out row by row (a glove), a column per measure.
 */
export function cellPath(size: string, measures: readonly Measure[], index: number): ["sizes", string, "gloves", number, Measure] {
  return ["sizes", size, "gloves", Math.floor(index / measures.length), measures[index % measures.length]];
}

/** The size heading in the template's wording: "Dimension - Size {size}". */
export function sizeHeading(template: string, size: string): string {
  return template.replaceAll("{size}", size);
}
