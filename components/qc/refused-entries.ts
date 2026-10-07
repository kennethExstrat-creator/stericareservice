"use client";

// Where a screen keeps the entries its number fields refused ("2 42" is not
// stored: BUILD_SPEC 6.2 rule 1), by the field's issue path, so the refused
// text and its reason outlive the field: SizeTabs shows one size's panel at
// a time, a section switch unmounts the module, a reload starts afresh. The
// capture screen provides one per section (and keeps them on the device);
// MeasurementGrid's cells (with `cellIssuePath`) and NumberField (with
// `issuePath`) read and write their refused entries there. Without a store,
// or a path, a field keeps its own while it is on screen, as before. An
// entry only ever shows while the stored value is null: a value set since
// supersedes it, and the field lets it go.
import { createContext, useContext } from "react";
import type { IssuePath } from "./issue-path";
import type { InvalidEntry } from "./numeric-entry";

export type RefusedEntryStore = {
  /** The entry refused at `path` (a field's issue path in this section), if one is kept. */
  get(path: IssuePath): InvalidEntry | undefined;
  /** Keeps `entry` for the field at `path`, with the field's name for lists away from it; null lets it go. */
  set(path: IssuePath, entry: InvalidEntry | null, label?: string): void;
};

export const RefusedEntryStoreContext = createContext<RefusedEntryStore | null>(null);

/** The section's store of refused entries; null where the screen keeps none (read-only, or outside capture). */
export function useRefusedEntryStore(): RefusedEntryStore | null {
  return useContext(RefusedEntryStoreContext);
}

/** Two entries say the same: the same text refused for the same reason. */
export function sameInvalidEntry(a: InvalidEntry | null | undefined, b: InvalidEntry | null | undefined): boolean {
  return (a ?? null) === (b ?? null) || (a != null && b != null && a.raw === b.raw && a.error === b.error);
}
