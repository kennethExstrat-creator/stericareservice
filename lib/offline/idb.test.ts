import { describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "./__fixtures__/fake-indexeddb";
import { OFFLINE_DB_NAME, OFFLINE_STORES, openOfflineDatabase, requestPersistentStorage } from "./db";
import { openIndexedDb } from "./idb";
import { createMemoryDatabase, createMemoryStore, type KeyValueStore } from "./kv";

type Item = { n: number; tags: string[] };

function indexedStore(fake = new FakeIndexedDb()) {
  const db = openIndexedDb({ name: "test", version: 1, stores: ["things", "other"], factory: fake.asFactory() });
  return { fake, db, store: db.store<Item>("things") };
}

describe.each<[string, () => KeyValueStore<Item>]>([
  ["memory", () => createMemoryStore<Item>()],
  ["IndexedDB", () => indexedStore().store],
])("KeyValueStore (%s)", (_, makeStore) => {
  it("reads back what it wrote, as a copy", async () => {
    const store = makeStore();
    const value = { n: 1, tags: ["a"] };
    await store.put("one", value);
    value.tags.push("changed after put");

    const read = await store.get("one");
    expect(read).toEqual({ n: 1, tags: ["a"] });
    read?.tags.push("changed after get");
    expect(await store.get("one")).toEqual({ n: 1, tags: ["a"] });
    expect(await store.get("missing")).toBeUndefined();
  });

  it("lists keys and values in key order", async () => {
    const store = makeStore();
    await store.put("b", { n: 2, tags: [] });
    await store.put("a", { n: 1, tags: [] });
    await store.put("c", { n: 3, tags: [] });
    expect(await store.keys()).toEqual(["a", "b", "c"]);
    expect((await store.getAll()).map((item) => item.n)).toEqual([1, 2, 3]);
  });

  it("deletes one key or everything", async () => {
    const store = makeStore();
    await store.put("a", { n: 1, tags: [] });
    await store.put("b", { n: 2, tags: [] });
    await store.delete("a");
    await store.delete("not there");
    expect(await store.keys()).toEqual(["b"]);
    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });
});

describe("openIndexedDb", () => {
  it("creates the stores on the first open", async () => {
    const { fake, db } = indexedStore();
    await db.ready();
    expect([...(fake.databases.get("test")?.stores.keys() ?? [])]).toEqual(["things", "other"]);
    expect(db.persistent).toBe(true);
  });

  it("resolves a write only once its transaction has committed", async () => {
    const { fake, store } = indexedStore();
    await store.put("a", { n: 1, tags: [] });
    expect(fake.peek("test", "things", "a")).toEqual({ n: 1, tags: [] });
  });

  it("asks for strict durability on writes only", async () => {
    const { fake, store } = indexedStore();
    await store.put("a", { n: 1, tags: [] });
    await store.get("a");
    expect(fake.transactions).toEqual([
      { store: "things", mode: "readwrite", durability: "strict" },
      { store: "things", mode: "readonly", durability: undefined },
    ]);
  });

  it("rejects a failed write with the browser's error and stores nothing", async () => {
    const { fake, store } = indexedStore();
    fake.failNext("put", new DOMException("The quota has been exceeded.", "QuotaExceededError"));
    await expect(store.put("a", { n: 1, tags: [] })).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(await store.get("a")).toBeUndefined();
    expect(fake.opens).toBe(1);
  });

  it("steps aside when another tab upgrades the database, and reconnects on the next call", async () => {
    const { fake, db, store } = indexedStore();
    await store.put("a", { n: 1, tags: [] });
    fake.fireVersionChange();
    expect(fake.connections[0].closed).toBe(true);

    await store.put("b", { n: 2, tags: [] });
    expect(fake.opens).toBe(2);
    expect(await store.keys()).toEqual(["a", "b"]);
    db.close();
  });

  it("reconnects once when iPadOS has dropped the connection", async () => {
    const { fake, store } = indexedStore();
    await store.put("a", { n: 1, tags: [] });
    fake.dropConnections();

    await store.put("b", { n: 2, tags: [] });
    expect(fake.opens).toBe(2);
    expect(await store.get("b")).toEqual({ n: 2, tags: [] });
  });

  it("rejects unknown stores, and every call after close()", async () => {
    const { db, store } = indexedStore();
    expect(() => db.store("nope" as "things")).toThrow(/Unknown store/);
    db.close();
    await expect(store.get("a")).rejects.toThrow(/closed/);
  });

  it("rejects ready() when the browser refuses IndexedDB, and opens again later", async () => {
    const { fake, db } = indexedStore();
    fake.refuseOpen = new DOMException("IndexedDB is disabled.", "InvalidStateError");
    await expect(db.ready()).rejects.toMatchObject({ name: "InvalidStateError" });
    fake.refuseOpen = null;
    await expect(db.ready()).resolves.toBeUndefined();
  });
});

describe("openOfflineDatabase", () => {
  it("opens IndexedDB with the three stores", async () => {
    const fake = new FakeIndexedDb();
    const db = await openOfflineDatabase(fake.asFactory());
    expect(db.persistent).toBe(true);
    expect([...(fake.databases.get(OFFLINE_DB_NAME)?.stores.keys() ?? [])]).toEqual([...OFFLINE_STORES]);
    await db.store("drafts").put("k", { ok: true });
    expect(await db.store("drafts").get("k")).toEqual({ ok: true });
  });

  it("falls back to memory when IndexedDB is missing or refused", async () => {
    expect((await openOfflineDatabase(undefined)).persistent).toBe(false);

    const fake = new FakeIndexedDb();
    fake.refuseOpen = new DOMException("No IndexedDB in private windows.", "SecurityError");
    const db = await openOfflineDatabase(fake.asFactory());
    expect(db.persistent).toBe(false);
    await db.store("uploads").put("job", { id: "job" });
    expect(await db.store("uploads").keys()).toEqual(["job"]);
  });
});

describe("createMemoryDatabase", () => {
  it("hands out the same store each time, so a test can reload on it", async () => {
    const db = createMemoryDatabase(["a", "b"] as const);
    await db.store<number>("a").put("x", 1);
    expect(await db.store<number>("a").get("x")).toBe(1);
    expect(await db.store<number>("b").get("x")).toBeUndefined();
    expect(() => db.store("c" as "a")).toThrow(/Unknown store/);
  });
});

describe("requestPersistentStorage", () => {
  it("asks only when storage is not persistent yet", async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(await requestPersistentStorage({ persisted: async () => false, persist })).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("answers false when the browser declines, throws or has no StorageManager", async () => {
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe(false);
    expect(
      await requestPersistentStorage({
        persisted: async () => false,
        persist: async () => {
          throw new Error("not allowed");
        },
      }),
    ).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBe(false);
  });
});
