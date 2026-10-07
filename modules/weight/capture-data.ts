// What the capture screen reads from and writes to the saved data, kept pure
// so it is tested without a browser: a size's first n values, the grid's
// changed cells as values, the data with them written in, the data without
// the values past n, and calc's figures for the grid's footer. Writes go
// through useDataUpdater (docs/CAPTURE_KIT.md), so each starts from the
// latest data, never from the data the screen rendered with.
import type { MeasureSummary, MeasurementChange } from "@/components/qc";
import type { WeightComputed } from "./calc";
import type { WeightData } from "./schema";

/** The grid's one column: the weights. */
export const VALUES_COLUMN = "values";

/** One value to store: glove `index` of the size (0 is glove 1). */
export type ValueChange = { readonly index: number; readonly value: number | null };

/** The size's first `count` values, null where nothing is entered. */
export function firstValues(data: WeightData, size: string, count: number): (number | null)[] {
  const saved = data.sizes[size]?.values ?? [];
  return Array.from({ length: count }, (_, index) => saved[index] ?? null);
}

/** The grid's changed cells (onCellsChange) as values; a cell of another column is left out. */
export function valueChanges(changes: readonly MeasurementChange[]): ValueChange[] {
  return changes.flatMap(({ row, measure, value }) => (measure === VALUES_COLUMN ? [{ index: row, value }] : []));
}

/**
 * The whole data with the size's changed values written in, built on
 * `current`. Every other size is kept, ordered or not (6.2 rule 4), and so is
 * every other value, those past n included (calc says they are not counted).
 * Empty values at the end are dropped. Returns `current` itself when nothing
 * changes, so no save follows.
 */
export function withValues(current: WeightData, size: string, changes: readonly ValueChange[]): WeightData {
  const entry = current.sizes[size];
  const saved = entry?.values ?? [];
  const pending = changes.filter(({ index, value }) => (saved[index] ?? null) !== value);
  if (pending.length === 0) return current;
  const values = [...saved];
  for (const { index, value } of pending) {
    while (values.length <= index) values.push(null);
    values[index] = value;
  }
  while (values.length > 0 && values[values.length - 1] === null) values.pop();
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, values } } };
}

/**
 * The whole data with the size's values past `n` removed, built on `current`:
 * the values calc says are not counted (weight_beyond_n), which the screen has
 * no cell for. Empty values at the end go too. Returns `current` itself when
 * there are none.
 */
export function withoutValuesPast(current: WeightData, size: string, n: number): WeightData {
  const entry = current.sizes[size];
  if (!entry || entry.values.length <= n) return current;
  const values = entry.values.slice(0, n);
  while (values.length > 0 && values[values.length - 1] === null) values.pop();
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, values } } };
}

/**
 * calc's figures for the size's grid footer: the average of the values it
 * counts, how many, and the spec's verdict on the printed average. The verdict
 * row is the spec's alone (the size's result, with the deviation's warning,
 * sits beside the heading): NA without a spec to judge by, else the size's
 * pass or fail, a warning being a pass on the spec. Undefined while calc has
 * no figures for the size: the grid then summarises its cells itself.
 */
export function gridSummary(computed: Partial<WeightComputed> | undefined, size: string): MeasureSummary | undefined {
  const average = computed?.average?.[size];
  const result = computed?.result?.[size];
  if (average === undefined || result === undefined) return undefined;
  const spec = computed?.spec?.[size] ?? null;
  const count = computed?.count?.[size];
  if (spec === null || spec.kind === "na") return { statistic: average, outcome: "na", count };
  const outcome = result === "fail" || result === "not_done" ? result : "pass";
  return { statistic: average, outcome, count };
}
