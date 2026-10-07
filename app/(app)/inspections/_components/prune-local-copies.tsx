"use client";

// Housekeeping on this device (docs/OFFLINE.md, item 9). Once per tab, a few
// seconds after the inspections list shows, the local copies of inspection
// data that were saved to the server and not touched for LOCAL_COPY_DAYS go,
// and so do refused-entry records as old. A copy holding changes not yet
// saved is never removed: pruneSyncedDrafts skips it.
import { useEffect } from "react";
import { getOfflineDatabase } from "@/lib/offline/db";
import { pruneSyncedDrafts } from "@/lib/offline/drafts";

/** How long a saved local copy, or a refused entry, stays on the device untouched. */
export const LOCAL_COPY_DAYS = 30;
/** Set in the tab's sessionStorage once the housekeeping has run. */
export const PRUNED_KEY = "stericare:pruned-local-copies";
/** The wait after the list shows, so the housekeeping never competes with it. */
export const PRUNE_DELAY_MS = 3_000;

const DAY_MS = 24 * 60 * 60 * 1000;

type TabStorage = Pick<Storage, "getItem" | "setItem">;

function tabStorage(): TabStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Runs the housekeeping unless this tab already has. Answers how many records
 * went, or null when it did not run or failed. Never rejects.
 */
export async function pruneOldLocalCopies(now: number, storage: TabStorage | null = tabStorage()): Promise<number | null> {
  try {
    if (storage?.getItem(PRUNED_KEY)) return null;
    storage?.setItem(PRUNED_KEY, "1");
  } catch {
    // Storage refused (private browsing): run anyway, it is cheap and safe.
  }
  try {
    const db = await getOfflineDatabase();
    return await pruneSyncedDrafts(db.store("drafts"), now - LOCAL_COPY_DAYS * DAY_MS);
  } catch (error) {
    console.warn("[inspections] Old local copies could not be pruned", error);
    return null;
  }
}

/** Renders nothing: prunes this device's old local copies once per tab. */
export function PruneLocalCopies() {
  useEffect(() => {
    const timer = setTimeout(() => void pruneOldLocalCopies(Date.now()), PRUNE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
