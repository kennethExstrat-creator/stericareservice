// What the capture screen writes to the saved data, kept pure so it is
// tested without a browser: the whole data back with one size's first n
// values replaced (MODULES.md 10: onChange takes the whole value, sizes no
// longer ordered included).
import type { WeightData } from "./schema";

/** The size's first `count` values, null where nothing is entered. */
export function firstValues(data: WeightData, size: string, count: number): (number | null)[] {
  const saved = data.sizes[size]?.values ?? [];
  return Array.from({ length: count }, (_, index) => saved[index] ?? null);
}

/**
 * The whole data with one size's first `count` values replaced. Every other
 * size is kept, ordered or not (6.2 rule 4); values past `count` keep what
 * was saved (calc says they are not counted); empty values at the end are
 * dropped.
 */
export function withFirstValues(
  data: WeightData,
  size: string,
  first: readonly (number | null)[],
  count: number,
): WeightData {
  const saved = data.sizes[size]?.values ?? [];
  const values = Array.from({ length: Math.max(saved.length, count) }, (_, index) =>
    index < count ? (first[index] ?? null) : (saved[index] ?? null),
  );
  while (values.length > 0 && values[values.length - 1] === null) values.pop();
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], values } } };
}
