import { describe, expect, it } from "vitest";
import { z } from "zod";
import { version } from "./__fixtures__/fake-server";
import {
  discardSetAsideDraft,
  draftKey,
  draftStamp,
  findUnsavedDraft,
  listSetAsideDrafts,
  listUnsavedDrafts,
  pruneSyncedDrafts,
  readDraft,
  reconcile,
  restoreSetAsideDraft,
  writeDraft,
  writerLockName,
  type LocalDraft,
} from "./drafts";
import { createMemoryStore } from "./kv";
import { pageLock } from "./lock";
import { contentHash } from "./stable-json";

type Data = { modules: Record<string, unknown> };

const owner = { userId: "user-1", inspectionId: "insp-1" };
const NOW = 1_780_000_000_000;

const original: Data = { modules: { weight: { values: [5.1] } } };
const edited: Data = { modules: { weight: { values: [5.1, 5.3] } } };
const elsewhere: Data = { modules: { weight: { values: [9.9] } } };

function draft(overrides: Partial<LocalDraft<Data>> = {}): LocalDraft<Data> {
  return {
    v: 1,
    ...owner,
    data: edited,
    revision: 3,
    syncedRevision: 1,
    baseUpdatedAt: version(5),
    baseHash: contentHash(original),
    sentHashes: [],
    changedAt: NOW - 60_000,
    savedAt: NOW - 120_000,
    ...overrides,
  };
}

describe("reconcile (the reload rule)", () => {
  it("uses the server copy when this device has nothing", () => {
    const result = reconcile<Data>(null, { data: original, updatedAt: version(5) }, owner, NOW);
    expect(result).toMatchObject({ kind: "current", data: original });
    expect(result.kind === "current" && result.draft).toMatchObject({
      revision: 0,
      syncedRevision: 0,
      baseUpdatedAt: version(5),
      baseHash: contentHash(original),
      changedAt: NOW,
    });
  });

  it("uses the server copy when everything here was saved", () => {
    const synced = draft({ data: original, syncedRevision: 3 });
    const result = reconcile(synced, { data: elsewhere, updatedAt: version(9) }, owner, NOW);
    expect(result).toMatchObject({ kind: "current", data: elsewhere });
    expect(result.kind === "current" && result.draft).toMatchObject({ baseUpdatedAt: version(9), revision: 3, syncedRevision: 3 });
  });

  it("keeps this device's newer saved state when the page's copy is older (back/forward cache)", () => {
    const synced = draft({ data: edited, syncedRevision: 3, baseHash: contentHash(edited) });
    const result = reconcile(synced, { data: original, updatedAt: version(4) }, owner, NOW);
    expect(result).toMatchObject({ kind: "current", data: edited });
    expect(result.kind === "current" && result.draft.baseUpdatedAt).toBe(version(5));
  });

  it("restores unsaved changes when the server is still at the version they were made on", () => {
    const local = draft();
    const result = reconcile(local, { data: original, updatedAt: version(5) }, owner, NOW);
    expect(result).toEqual({ kind: "restored", data: edited, draft: local });
  });

  it("restores unsaved changes when the page's copy is older than this device's base", () => {
    const result = reconcile(draft(), { data: elsewhere, updatedAt: version(2) }, owner, NOW);
    expect(result).toMatchObject({ kind: "restored", data: edited });
  });

  it("restores and rebases when only other columns moved on the server", () => {
    const result = reconcile(draft(), { data: original, updatedAt: version(8) }, owner, NOW);
    expect(result).toMatchObject({ kind: "restored", data: edited });
    expect(result.kind === "restored" && result.draft).toMatchObject({
      baseUpdatedAt: version(8),
      baseHash: contentHash(original),
      revision: 3,
      syncedRevision: 1,
    });
  });

  it("restores and rebases when the server holds a save from here whose answer was lost", () => {
    const halfway: Data = { modules: { weight: { values: [5.1, 5.2] } } };
    const local = draft({ sentHashes: [contentHash(halfway)] });
    const result = reconcile(local, { data: halfway, updatedAt: version(8) }, owner, NOW);
    expect(result).toMatchObject({ kind: "restored", data: edited });
    expect(result.kind === "restored" && result.draft.baseUpdatedAt).toBe(version(8));
  });

  it("has nothing to save when the server already holds exactly the local data", () => {
    const result = reconcile(draft(), { data: structuredClone(edited), updatedAt: version(8) }, owner, NOW);
    expect(result).toMatchObject({ kind: "current", data: edited });
    expect(result.kind === "current" && result.draft).toMatchObject({ revision: 3, syncedRevision: 3, baseUpdatedAt: version(8) });
  });

  it("is a conflict when someone else changed the data while this device had unsaved changes", () => {
    const local = draft();
    const server = { data: elsewhere, updatedAt: version(8) };
    expect(reconcile(local, server, owner, NOW)).toEqual({ kind: "conflict", local, server });
  });

  it("is a conflict when the versions cannot be compared and the data is unknown", () => {
    const result = reconcile(draft(), { data: elsewhere, updatedAt: "not a timestamp" }, owner, NOW);
    expect(result.kind).toBe("conflict");
  });
});

describe("local copy records", () => {
  it("writes and reads a local copy under the user's and inspection's key", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, draft());
    expect(await store.keys()).toEqual([draftKey(owner)]);
    expect(await readDraft<Data>(store, owner)).toEqual({ status: "ok", draft: draft(), stamp: draftStamp(draft()) });
    expect(await readDraft<Data>(store, { ...owner, userId: "user-2" })).toEqual({ status: "missing" });
  });

  it("stamps a stored copy so that any later write by anyone shows", () => {
    const stamp = draftStamp(draft({ writer: "tab-a" }));
    expect(stamp).toMatch(/^[0-9a-f]{16}$/);
    expect(draftStamp(structuredClone(draft({ writer: "tab-a" })))).toBe(stamp);
    expect(draftStamp(draft({ writer: "tab-b" }))).not.toBe(stamp);
    expect(draftStamp(draft({ writer: "tab-a", syncedRevision: 3 }))).not.toBe(stamp);
    expect(draftStamp({ v: 2, data: "from a newer app" })).toBeNull();
  });

  it("sets an unreadable copy aside instead of deleting or applying it", async () => {
    const store = createMemoryStore<unknown>();
    await store.put(draftKey(owner), { v: 0, something: "from an older app" });
    const read = await readDraft<Data>(store, owner, undefined, NOW);
    expect(read).toEqual({ status: "unreadable", quarantinedAs: `unreadable:user-1:insp-1:${NOW}` });
    expect(await store.get(`unreadable:user-1:insp-1:${NOW}`)).toEqual({ v: 0, something: "from an older app" });
    expect(await store.get(draftKey(owner))).toBeUndefined();
  });

  it("sets aside a copy whose data no longer fits the schema", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, draft({ data: { modules: "old shape" } as unknown as Data }));
    const schema = z.object({ modules: z.record(z.string(), z.unknown()) });
    expect((await readDraft(store, owner, schema, NOW)).status).toBe("unreadable");
  });

  it("finds unsaved changes for read-only screens, unless the server already has them", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, draft());
    expect(await findUnsavedDraft(store, owner, { data: original })).toMatchObject({ data: edited });
    expect(await findUnsavedDraft(store, owner, { data: edited })).toBeNull();
    await writeDraft(store, draft({ syncedRevision: 3 }));
    expect(await findUnsavedDraft(store, owner, { data: original })).toBeNull();
  });

  it("lists a user's unsaved inspections and prunes old synced copies only", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, draft());
    await writeDraft(store, draft({ inspectionId: "insp-2", syncedRevision: 3, changedAt: NOW - 90_000, savedAt: NOW - 90_000 }));
    await writeDraft(store, draft({ inspectionId: "insp-3", syncedRevision: 3, changedAt: NOW, savedAt: NOW }));
    await writeDraft(store, draft({ userId: "user-2" }));
    await store.put(`unreadable:user-1:insp-9:${NOW}`, { junk: true });

    expect((await listUnsavedDrafts(store, "user-1")).map((d) => d.inspectionId)).toEqual(["insp-1"]);
    expect(await pruneSyncedDrafts(store, NOW - 30_000)).toBe(1);
    expect(await store.keys()).toEqual([
      "draft:user-1:insp-1",
      "draft:user-1:insp-3",
      "draft:user-2:insp-1",
      `unreadable:user-1:insp-9:${NOW}`,
    ]);
  });
});

describe("set-aside copies", () => {
  const schema = z.object({ modules: z.record(z.string(), z.unknown()) });
  const oldShape = draft({ data: { modules: "old shape" } as unknown as Data });

  it("lists a user's set-aside copies, which the sign-out warning counts too", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, oldShape);
    await readDraft(store, owner, schema, NOW);
    await store.put(`unreadable:user-2:insp-1:${NOW}`, { theirs: true });

    expect(await listSetAsideDrafts(store, "user-1")).toEqual([
      { key: `unreadable:user-1:insp-1:${NOW}`, inspectionId: "insp-1", setAsideAt: NOW, value: oldShape },
    ]);
    expect(await listUnsavedDrafts(store, "user-1")).toEqual([]);
  });

  it("puts one back as the local copy for the next start to read again", async () => {
    const store = createMemoryStore<unknown>();
    await writeDraft(store, oldShape);
    await readDraft(store, owner, schema, NOW);
    const [{ key }] = await listSetAsideDrafts(store, "user-1");

    expect(await restoreSetAsideDraft(store, key, pageLock())).toBe(true);
    expect(await store.keys()).toEqual([draftKey(owner)]);
    expect(await readDraft(store, owner)).toMatchObject({ status: "ok", draft: { data: { modules: "old shape" } } });
  });

  it("never restores over unsaved or unreadable work, nor while the inspection is open", async () => {
    const store = createMemoryStore<unknown>();
    const key = `unreadable:user-1:insp-1:${NOW}`;
    await store.put(key, oldShape);

    await writeDraft(store, draft());
    expect(await restoreSetAsideDraft(store, key, pageLock())).toBe(false);
    await store.put(draftKey(owner), { v: 7 });
    expect(await restoreSetAsideDraft(store, key, pageLock())).toBe(false);

    await writeDraft(store, draft({ syncedRevision: 3 }));
    const lock = pageLock();
    const release = await lock.acquire(writerLockName(owner), 0);
    expect(await restoreSetAsideDraft(store, key, lock)).toBe(false);
    release?.();
    expect(await restoreSetAsideDraft(store, key, lock)).toBe(true);
    expect(await restoreSetAsideDraft(store, key, lock)).toBe(false);
    expect(await restoreSetAsideDraft(store, "draft:user-1:insp-1", lock)).toBe(false);
  });

  it("discards one for good, and only set-aside keys", async () => {
    const store = createMemoryStore<unknown>();
    const key = `unreadable:user-1:insp-1:${NOW}`;
    await store.put(key, oldShape);
    await writeDraft(store, draft());
    await discardSetAsideDraft(store, key);
    await discardSetAsideDraft(store, draftKey(owner));
    expect(await store.keys()).toEqual([draftKey(owner)]);
  });
});
