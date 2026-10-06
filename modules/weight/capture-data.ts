// What the capture screen reads from and writes to the saved data, kept pure
// so it is tested without a browser: a size's first n values, the values a
// change touched, the data with them written in, and the data without the
// values past n. Writes go through
// useDataUpdater (docs/CAPTURE_KIT.md), so each starts from the latest data,
// never from the data the screen rendered with.
import type { WeightData } from "./schema";

/** One value to store: glove `index` of the size (0 is glove 1). */
export type ValueChange = { readonly index: number; readonly value: number | null };

/** The size's first `count` values, null where nothing is entered. */
export function firstValues(data: WeightData, size: string, count: number): (number | null)[] {
  const saved = data.sizes[size]?.values ?? [];
  return Array.from({ length: count }, (_, index) => saved[index] ?? null);
}

/**
 * The values a grid change touched: its new values against the values it was
 * rendered with. Only these are written: the grid builds each change from what
 * it last rendered, so its other values may be out of date by the time the
 * change lands (two commits in one event) and must not be written back.
 */
export function valueChanges(
  before: readonly (number | null)[],
  after: readonly (number | null)[],
  count: number,
): ValueChange[] {
  return Array.from({ length: count }, (_, index) => ({ index, value: after[index] ?? null })).filter(
    (change) => change.value !== (before[change.index] ?? null),
  );
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
