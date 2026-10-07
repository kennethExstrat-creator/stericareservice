import { describe, expect, it } from "vitest";
import { listSetAsideDrafts, listUnsavedDrafts, pruneSyncedDrafts, writeDraft, type LocalDraft } from "./drafts";
import { createMemoryStore } from "./kv";
import {
  MAX_REFUSED_ENTRIES,
  readRefusedEntries,
  refusedEntriesKey,
  writeRefusedEntries,
  type StoredRefusedEntry,
} from "./refused";

const owner = { userId: "user-1", inspectionId: "insp-1" };
const NOW = 1_780_000_000_000;

const refused: StoredRefusedEntry = {
  namespace: "modules",
  section: "dimensions",
  path: ["sizes", "S", "gloves", 2, "length"],
  raw: "2 42",
  error: "One number per cell.",
  label: "Length, No. 3",
};

describe("refused entries on this device", () => {
  it("keeps them per user and inspection, beside the local copy and apart from it", async () => {
    const store = createMemoryStore<unknown>();
    await writeRefusedEntries(store, owner, [refused], NOW);

    expect(await store.keys()).toEqual(["refused:user-1:insp-1"]);
    expect(refusedEntriesKey(owner)).toBe("refused:user-1:insp-1");
    expect(await readRefusedEntries(store, owner)).toEqual([refused]);
    // Another inspector on a shared iPad, or another inspection, never sees them.
    expect(await readRefusedEntries(store, { ...owner, userId: "user-2" })).toEqual([]);
    expect(await readRefusedEntries(store, { ...owner, inspectionId: "insp-2" })).toEqual([]);
  });

  it("deletes the record once nothing is refused any more", async () => {
    const store = createMemoryStore<unknown>();
    await writeRefusedEntries(store, owner, [refused], NOW);
    await writeRefusedEntries(store, owner, [], NOW + 1);
    expect(await store.keys()).toEqual([]);
    expect(await readRefusedEntries(store, owner)).toEqual([]);
  });

  it("reads a record it cannot parse as nothing, without throwing", async () => {
    const store = createMemoryStore<unknown>();
    await store.put(refusedEntriesKey(owner), { v: 2, entries: "later shape" });
    expect(await readRefusedEntries(store, owner)).toEqual([]);
    await store.put(refusedEntriesKey(owner), { v: 1, userId: "user-1", inspectionId: "insp-1", changedAt: NOW, entries: [{ raw: 1 }] });
    expect(await readRefusedEntries(store, owner)).toEqual([]);
  });

  it("keeps the newest entries when there are too many", async () => {
    const store = createMemoryStore<unknown>();
    const many = Array.from({ length: MAX_REFUSED_ENTRIES + 3 }, (_, index) => ({ ...refused, path: ["values", index] }));
    await writeRefusedEntries(store, owner, many, NOW);
    const kept = await readRefusedEntries(store, owner);
    expect(kept).toHaveLength(MAX_REFUSED_ENTRIES);
    expect(kept[0].path).toEqual(["values", 3]);
  });

  it("is not a local copy: the sign-out warning and set-aside lists leave it out", async () => {
    const store = createMemoryStore<unknown>();
    await writeRefusedEntries(store, owner, [refused], NOW);
    expect(await listUnsavedDrafts(store, "user-1")).toEqual([]);
    expect(await listSetAsideDrafts(store, "user-1")).toEqual([]);
  });

  it("goes with housekeeping once it is old, as synced local copies do", async () => {
    const store = createMemoryStore<unknown>();
    const synced: LocalDraft = {
      v: 1,
      ...owner,
      data: {},
      revision: 1,
      syncedRevision: 1,
      baseUpdatedAt: "2026-10-06T09:14:03.123456+00:00",
      baseHash: "h",
      sentHashes: [],
      changedAt: NOW,
      savedAt: NOW,
    };
    await writeDraft(store, synced);
    await writeRefusedEntries(store, owner, [refused], NOW - 60_000);
    await writeRefusedEntries(store, { ...owner, inspectionId: "insp-2" }, [refused], NOW);

    expect(await pruneSyncedDrafts(store, NOW - 30_000)).toBe(1);
    expect(await store.keys()).toEqual(["draft:user-1:insp-1", "refused:user-1:insp-2"]);
  });
});
