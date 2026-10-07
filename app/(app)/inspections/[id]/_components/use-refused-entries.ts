"use client";

// The capture screen's refused entries (lib/inspections/capture/refused.ts):
// what its number fields refused ("2 42" is not stored), by section and
// issue path, so the refused text and its reason come back after a size
// switch, a section switch and a reload (Kenneth: nothing typed is ever lost
// on a reload). Each section's fields read and write them through the kit's
// store (components/qc refused-entries.ts). They live in memory and on this
// device beside the local copy of the data, never in it (lib/offline
// refused.ts), and are read back when the screen opens. An entry goes when a
// number lands at its path (settle), and all go once the inspection is
// submitted (clear). Only the screen that saves the inspection keeps them:
// read-only, a second tab or before saving has started, fields keep their
// own while they are on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { issuePathKey, type RefusedEntryStore } from "@/components/qc";
import {
  mergeRefusedEntries,
  NO_REFUSED_ENTRIES,
  refusedEntriesFrom,
  sectionRefusedEntries,
  settledRefusedKeys,
  withoutRefusedKeys,
  withRefusedEntry,
  type RefusedEntries,
} from "@/lib/inspections/capture/refused";
import { getOfflineDatabase, readRefusedEntries, writeRefusedEntries } from "@/lib/offline";
import type { DataNamespace, InspectionData } from "@/modules/_framework";

export type CaptureRefusedEntries = {
  entries: RefusedEntries;
  /** The store a section's fields use; null while this screen keeps none. Changes when the entries do. */
  storeFor: (namespace: DataNamespace, section: string) => RefusedEntryStore | null;
  /** Lets go of the entries whose value has landed in `data` since (settledRefusedKeys). */
  settle: (data: InspectionData) => void;
  /** Lets go of every entry: the inspection was submitted. */
  clear: () => void;
};

export function useRefusedEntries({
  inspectionId,
  userId,
  active,
}: {
  inspectionId: string;
  /** Entries are kept per user, like the local copies. */
  userId: string;
  /** This screen saves the inspection (editable here, saving running): it keeps and writes them. */
  active: boolean;
}): CaptureRefusedEntries {
  const [entries, setEntries] = useState<RefusedEntries>(NO_REFUSED_ENTRIES);
  // The entries now, also within the event that changed them: several fields can report in one event (a paste).
  const latest = useRef<RefusedEntries>(NO_REFUSED_ENTRIES);
  // Read back from the device yet: nothing is written over what it keeps before that.
  const loaded = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const owner = useMemo(() => ({ userId, inspectionId }), [userId, inspectionId]);

  /** One write at a time, in order: the device ends up with the newest entries. */
  const persist = useCallback(
    (next: RefusedEntries) => {
      if (!loaded.current) return;
      const list = [...next.values()];
      writes.current = writes.current
        .then(async () => {
          const db = await getOfflineDatabase();
          await writeRefusedEntries(db.store("drafts"), owner, list);
        })
        // A convenience on top of the data, which the autosave keeps: a refused write changes nothing on screen.
        .catch(() => undefined);
    },
    [owner],
  );

  const apply = useCallback(
    (next: RefusedEntries) => {
      if (next === latest.current) return;
      latest.current = next;
      setEntries(next);
      persist(next);
    },
    [persist],
  );

  // What the device kept from before (the page was reloaded, or opened again), under what was refused since.
  useEffect(() => {
    if (!active || loaded.current) return;
    let cancelled = false;
    void (async () => {
      let stored: RefusedEntries = NO_REFUSED_ENTRIES;
      try {
        const db = await getOfflineDatabase();
        stored = refusedEntriesFrom(await readRefusedEntries(db.store("drafts"), owner));
      } catch {
        // Nothing to read back: what is refused from now on is kept as usual.
      }
      if (cancelled) return;
      loaded.current = true;
      const merged = mergeRefusedEntries(stored, latest.current);
      latest.current = merged;
      setEntries(merged);
      if (merged !== stored) persist(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, owner, persist]);

  const storeFor = useCallback(
    (namespace: DataNamespace, section: string): RefusedEntryStore | null => {
      if (!active) return null;
      const own = sectionRefusedEntries(entries, namespace, section);
      return {
        get: (path) => own.get(issuePathKey(path)),
        set: (path, entry, label) => apply(withRefusedEntry(latest.current, { namespace, section, path }, entry, label)),
      };
    },
    [active, entries, apply],
  );

  const settle = useCallback(
    (data: InspectionData) => {
      if (!active) return;
      const settled = settledRefusedKeys(latest.current, data);
      if (settled.length > 0) apply(withoutRefusedKeys(latest.current, settled));
    },
    [active, apply],
  );

  const clear = useCallback(() => apply(NO_REFUSED_ENTRIES), [apply]);

  return { entries: active ? entries : NO_REFUSED_ENTRIES, storeFor, settle, clear };
}
