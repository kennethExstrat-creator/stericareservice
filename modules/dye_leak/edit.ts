// Pure edits of the saved data, for Capture's `update((current) => ...)`
// (useDataUpdater, docs/CAPTURE_KIT.md). Each starts from the latest data, so
// two changes in one event both land, and returns the whole new value with
// every saved size kept, also sizes no longer ordered: their counts come back
// if the size is ordered again (6.2 rule 4).
import { emptyDyeLeakSize, type DyeLeakData, type DyeLeakSize } from "./schema";

/** Some values of one size replaced; null clears a value. */
export function withSizeValues(data: DyeLeakData, size: string, values: Partial<DyeLeakSize>): DyeLeakData {
  const entry = data.sizes[size] ?? emptyDyeLeakSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, ...values } } };
}

/**
 * A clean size in one tap: no leaking pouch, and the plan as the pouches
 * tested while none are entered. A count already in `data` is kept, also one
 * entered earlier in the same event.
 */
export function withNoLeaks(data: DyeLeakData, size: string, planned: number | null): DyeLeakData {
  const tested = data.sizes[size]?.pouchesTested ?? null;
  return withSizeValues(data, size, {
    pouchesFailed: 0,
    ...(tested === null && planned !== null ? { pouchesTested: planned } : {}),
  });
}
