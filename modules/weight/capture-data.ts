// What the capture screen reads from and writes to the saved data, kept pure
// so it is tested without a browser: the size's one value, and the data with
// a value written in. Writes go through useDataUpdater (docs/CAPTURE_KIT.md),
// so each starts from the latest data, never from the data the screen
// rendered with.
import { mean, roundTo } from "@/lib/stats";
import type { WeightData } from "./schema";

/**
 * The size's one value, the average weight, as the cell shows it: the value
 * entered, never rounded; on an inspection saved before 26 October 2026,
 * which weighed its gloves one by one, their average at the template's
 * decimals, as calc prints and judges it. Null while nothing is entered.
 */
export function sizeValue(data: WeightData, size: string, decimals: number): number | null {
  const entered = (data.sizes[size]?.values ?? []).filter((value): value is number => value !== null);
  if (entered.length <= 1) return entered[0] ?? null;
  const average = mean(entered);
  return average === null ? null : roundTo(average, decimals);
}

/**
 * The whole data with the size's one value set, built on `current`: it
 * replaces whatever the size held, an older inspection's gloves weighed one
 * by one included; null empties the size. Every other size is kept, ordered
 * or not (6.2 rule 4). Returns `current` itself when nothing changes, so no
 * save follows.
 */
export function withValue(current: WeightData, size: string, value: number | null): WeightData {
  const entry = current.sizes[size];
  const saved = entry?.values ?? [];
  const unchanged = value === null ? saved.every((entered) => entered === null) : saved.length === 1 && saved[0] === value;
  if (unchanged) return current;
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, values: value === null ? [] : [value] } } };
}
