import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeInspectionServer } from "./__fixtures__/fake-server";
import {
  AUTOSAVE_LOCK_WAIT_MS,
  BUSY_MESSAGE,
  SUPERSEDED_MESSAGE,
  createAutosave,
  type AutosaveStatus,
} from "./autosave";
import { manualConnectivity, type ManualConnectivity } from "./connectivity";
import { draftKey, listUnsavedDrafts } from "./drafts";
import { createMemoryStore, type KeyValueStore } from "./kv";
import { pageLock, type WriterLock } from "./lock";
import type { AutosaveTransport } from "./protocol";
import { contentHash } from "./stable-json";

type Data = { modules: { weight?: { values: number[] }; visual?: { thin_spot: number } } };

const USER = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b";
const INSPECTION = "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10";
const KEY = draftKey({ userId: USER, inspectionId: INSPECTION });

/** Inspection data after `n` weighings. */
const d = (n: number): Data => ({ modules: { weight: { values: Array.from({ length: n }, (_, i) => 5 + i / 10) } } });
const other: Data = { modules: { visual: { thin_spot: 4 } } };

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function setup({
  server = new FakeInspectionServer<Data>(d(0)),
  store = createMemoryStore<unknown>(),
  net = manualConnectivity(true),
  lock = pageLock(),
  transport = server.transport(),
  persistent,
}: {
  server?: FakeInspectionServer<Data>;
  store?: KeyValueStore<unknown>;
  net?: ManualConnectivity;
  /** Controllers given the same lock are tabs of a browser with Web Locks; separate locks, a browser without. */
  lock?: WriterLock;
  transport?: AutosaveTransport<Data>;
  persistent?: boolean;
} = {}) {
  const hidden = new Set<() => void>();
  const autosave = createAutosave<Data>({
    inspectionId: INSPECTION,
    userId: USER,
    transport,
    store,
    persistent,
    lock,
    connectivity: net,
    lifecycle: {
      onHidden(listener) {
        hidden.add(listener);
        return () => hidden.delete(listener);
      },
    },
    random: () => 0,
  });
  const statuses: AutosaveStatus[] = [];
  autosave.subscribe(() => {
    const status = autosave.getSnapshot().status;
    if (statuses.at(-1) !== status) statuses.push(status);
  });
  return { server, store, net, autosave, statuses, hide: () => hidden.forEach((listener) => listener()) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("autosave: debounce and status", () => {
  it("saves once, 800 ms after the last change, with the newest data", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    autosave.change(d(1));
    await advance(500);
    autosave.change(d(2));
    await advance(500);
    autosave.change(d(3));
    await advance(799);
    expect(server.requests).toHaveLength(0);

    await advance(1);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].data).toEqual(d(3));
    expect(server.data).toEqual(d(3));
  });

  it("still saves every 5 s while the changes keep coming", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    for (let n = 1; n <= 10; n++) {
      autosave.change(d(n));
      await advance(n < 10 ? 500 : 499);
    }
    expect(server.requests).toHaveLength(0);
    await advance(1);
    expect(server.requests.map((request) => request.data)).toEqual([d(10)]);
  });

  it("moves the pill from Saved to Saving and back, and records when it saved", async () => {
    const { server, autosave, statuses } = setup();
    await autosave.start(server.copy());
    expect(autosave.getSnapshot()).toEqual({
      status: "saved",
      pending: false,
      lastSavedAt: null,
      online: true,
      error: null,
      conflict: null,
      retryAt: null,
      localCopy: true,
    });

    autosave.change(d(1));
    expect(autosave.getSnapshot()).toMatchObject({ status: "saving", pending: true });
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", pending: false, lastSavedAt: Date.now() });
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("writes every change to the local copy before the request leaves", async () => {
    const { server, store, autosave } = setup();
    const seenByServer: unknown[] = [];
    server.onRequest = async () => {
      seenByServer.push(await store.get(KEY));
    };
    await autosave.start(server.copy());
    autosave.change(d(1));
    await advance(0);
    expect(await store.get(KEY)).toMatchObject({ data: d(1), revision: 1, syncedRevision: 0 });

    await advance(800);
    expect(seenByServer).toEqual([
      expect.objectContaining({ data: d(1), revision: 1, syncedRevision: 0, sentHashes: [contentHash(d(1))] }),
    ]);
    expect(await store.get(KEY)).toMatchObject({ revision: 1, syncedRevision: 1, sentHashes: [], savedAt: Date.now() });
  });

  it("keeps one request in flight and sends what changed meanwhile right after it", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.hold();
    autosave.change(d(1));
    await advance(800);
    autosave.change(d(2));
    await advance(800);
    expect(server.requests).toHaveLength(1);
    expect(autosave.getSnapshot().status).toBe("saving");

    server.release();
    await advance(0);
    expect(server.requests.map((request) => request.data)).toEqual([d(1), d(2)]);
    expect(server.requests[1].baseUpdatedAt).not.toBe(server.requests[0].baseUpdatedAt);
    expect(server.data).toEqual(d(2));
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("returns the same snapshot until something changes (useSyncExternalStore)", async () => {
    const { server, autosave, hide } = setup();
    await autosave.start(server.copy());
    const first = autosave.getSnapshot();
    hide();
    await advance(1000);
    expect(autosave.getSnapshot()).toBe(first);
    autosave.change(d(1));
    expect(autosave.getSnapshot()).not.toBe(first);
  });

  it("refuses changes before start, and a second start", async () => {
    const { server, autosave } = setup();
    expect(() => autosave.change(d(1))).toThrow(/start\(\)/);
    await autosave.start(server.copy());
    await expect(autosave.start(server.copy())).rejects.toThrow(/already/);
  });
});

describe("autosave: offline and retries", () => {
  it("shows Offline (will sync), backs off, and retries at once when the connection returns", async () => {
    const { server, net, autosave } = setup();
    await autosave.start(server.copy());
    server.reachable = false;
    autosave.change(d(1));
    await advance(800);
    expect(server.requests).toHaveLength(1);
    expect(autosave.getSnapshot()).toMatchObject({
      status: "offline",
      pending: true,
      error: { reason: "network" },
      retryAt: Date.now() + 1000,
    });

    await advance(1000);
    expect(server.requests).toHaveLength(2);
    expect(autosave.getSnapshot().retryAt).toBe(Date.now() + 2000);

    // Edits while waiting do not add requests: the retry sends the newest data.
    autosave.change(d(2));
    await advance(1500);
    expect(server.requests).toHaveLength(2);

    net.set(false);
    expect(autosave.getSnapshot()).toMatchObject({ status: "offline", online: false });
    server.reachable = true;
    net.set(true);
    await advance(0);
    expect(server.requests).toHaveLength(3);
    expect(server.data).toEqual(d(2));
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", error: null, retryAt: null, online: true });
  });

  it("while the browser reports offline, waits for the online event, with a slow retry as a fallback", async () => {
    const net = manualConnectivity(false);
    const { server, autosave } = setup({ net });
    await autosave.start(server.copy());
    server.reachable = false;
    autosave.change(d(1));
    expect(autosave.getSnapshot().status).toBe("offline");
    await advance(800);
    expect(autosave.getSnapshot().retryAt).toBe(Date.now() + 30_000);
    await advance(29_999);
    expect(server.requests).toHaveLength(1);
    await advance(1);
    expect(server.requests).toHaveLength(2);
  });

  it("shows Offline (will sync) when a request stalls, aborts it and retries", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    const signals: AbortSignal[] = [];
    server.onRequest = (request) => {
      signals.push(request.signal);
    };
    server.hold();
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot().status).toBe("saving");

    await advance(30_000);
    expect(signals[0].aborted).toBe(true);
    expect(autosave.getSnapshot()).toMatchObject({ status: "offline", error: { reason: "network" } });

    server.release();
    await advance(1000);
    expect(server.data).toEqual(d(1));
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("asks the inspector to sign in again on an expired session, and keeps retrying", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.scripted.push({ ok: false, reason: "unauthorized" });
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: { reason: "unauthorized", message: expect.stringMatching(/sign in/i) },
      retryAt: Date.now() + 1000,
    });
    await advance(1000);
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("stops on refused data until the next change, which may fix it", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.scripted.push({ ok: false, reason: "invalid", message: "Weight must be a number." });
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: { reason: "invalid", message: "Weight must be a number." },
      retryAt: null,
    });
    await advance(60_000);
    expect(server.requests).toHaveLength(1);

    autosave.change(d(2));
    expect(autosave.getSnapshot().status).toBe("saving");
    await advance(800);
    expect(server.data).toEqual(d(2));
  });

  it("retries a refused save on request, e.g. once the inspection is editable again", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.editable = false;
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: { reason: "forbidden" } });

    server.editable = true;
    autosave.retryNow();
    await advance(0);
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("sends pending changes at once when the page is hidden", async () => {
    const { server, autosave, hide } = setup();
    await autosave.start(server.copy());
    autosave.change(d(1));
    hide();
    await advance(0);
    expect(server.requests).toHaveLength(1);
    expect(server.data).toEqual(d(1));
  });

  it("writes the local copy in the same task when the page is hidden, where the lock spans every tab", async () => {
    const store = createMemoryStore<unknown>();
    const webLock: WriterLock = { acquire: async () => Object.assign(() => undefined, { exclusive: true }) };
    const { server, autosave, hide } = setup({ store, lock: webLock });
    await autosave.start(server.copy());
    await advance(0);
    // A closing tab: reads never answer, so the usual write, which reads first, never happens.
    const put = vi.spyOn(store, "put");
    vi.spyOn(store, "get").mockReturnValue(new Promise(() => {}));
    autosave.change(d(1));
    hide();
    expect(put).toHaveBeenCalledWith(KEY, expect.objectContaining({ revision: 1, data: d(1) }));
  });

  it("keeps reading first where the lock covers this page only: another tab may have written the copy", async () => {
    const store = createMemoryStore<unknown>();
    const { server, autosave, hide } = setup({ store });
    await autosave.start(server.copy());
    await advance(0);
    const put = vi.spyOn(store, "put");
    autosave.change(d(1));
    hide();
    expect(put).not.toHaveBeenCalled();
    await advance(0);
    expect(put).toHaveBeenCalledWith(KEY, expect.objectContaining({ revision: 1 }));
  });
});

describe("autosave: versions and conflicts", () => {
  it("recognises its own save when the answer was lost, without asking", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.loseNextAnswer = true;
    autosave.change(d(1));
    await advance(800);
    expect(server.data).toEqual(d(1));
    expect(autosave.getSnapshot().status).toBe("offline");

    autosave.change(d(2));
    await advance(1000);
    // The retry hits a moved server holding this device's own payload: rebase and send again.
    expect(server.requests).toHaveLength(3);
    expect(server.data).toEqual(d(2));
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", conflict: null });
  });

  it("is not a conflict when only other columns changed on the server", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.writeElsewhere();
    autosave.change(d(1));
    await advance(800);
    expect(server.requests).toHaveLength(2);
    expect(server.data).toEqual(d(1));
    expect(autosave.getSnapshot().status).toBe("saved");
  });

  it("asks when someone else changed the data, and can keep this device's version", async () => {
    const { server, store, autosave } = setup();
    await autosave.start(server.copy());
    server.writeElsewhere(other);
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: { reason: "conflict" },
      conflict: { local: { data: d(1) }, server: { data: other } },
    });
    expect(await autosave.flush()).toMatchObject({ ok: false, reason: "conflict" });

    // Edits made while the question is open stay local and are not sent.
    autosave.change(d(2));
    await advance(60_000);
    expect(server.requests).toHaveLength(1);
    expect(await store.get(KEY)).toMatchObject({ data: d(2) });

    expect(autosave.resolveConflict("local")).toEqual(d(2));
    await advance(0);
    expect(server.data).toEqual(d(2));
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", conflict: null });
  });

  it("can drop this device's changes and take the server's version", async () => {
    const { server, store, autosave } = setup();
    await autosave.start(server.copy());
    server.writeElsewhere(other);
    autosave.change(d(1));
    await advance(800);

    expect(autosave.resolveConflict("server")).toEqual(other);
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", pending: false, conflict: null });
    await advance(60_000);
    expect(server.requests).toHaveLength(1);
    expect(await store.get(KEY)).toMatchObject({ data: other, baseUpdatedAt: server.updatedAt });
    expect(() => autosave.resolveConflict("server")).toThrow(/no conflict/);
  });
});

describe("autosave: reloads", () => {
  it("restores unsaved changes after a reload and saves them", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const before = setup({ server, store });
    await before.autosave.start(server.copy());
    server.reachable = false;
    before.autosave.change(d(1));
    await advance(800);
    await before.autosave.stop();

    server.reachable = true;
    const after = setup({ server, store });
    expect(await after.autosave.start(server.copy())).toEqual({
      kind: "restored",
      data: d(1),
      changedAt: Date.now() - 800,
    });
    await advance(0);
    expect(server.data).toEqual(d(1));
    expect(after.autosave.getSnapshot().status).toBe("saved");
  });

  it("restores without asking when a save landed but its answer was lost before the reload", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const before = setup({ server, store });
    await before.autosave.start(server.copy());
    server.loseNextAnswer = true;
    before.autosave.change(d(1));
    await advance(800);
    before.autosave.change(d(2));
    await before.autosave.stop();

    const after = setup({ server, store });
    expect(await after.autosave.start(server.copy())).toMatchObject({ kind: "restored", data: d(2) });
    await advance(0);
    expect(server.data).toEqual(d(2));
  });

  it("asks after a reload when someone else changed the data meanwhile", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const before = setup({ server, store });
    await before.autosave.start(server.copy());
    server.reachable = false;
    before.autosave.change(d(1));
    await advance(800);
    await before.autosave.stop();

    server.reachable = true;
    server.writeElsewhere(other);
    const after = setup({ server, store });
    expect(await after.autosave.start(server.copy())).toMatchObject({
      kind: "conflict",
      local: { data: d(1) },
      server: { data: other },
    });
    expect(after.autosave.getSnapshot().status).toBe("error");
    after.autosave.resolveConflict("local");
    await advance(0);
    expect(server.data).toEqual(d(1));
  });

  it("does not let a page copy from the back/forward cache roll back saved data", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const stale = server.copy();
    const before = setup({ server, store });
    await before.autosave.start(stale);
    before.autosave.change(d(1));
    await advance(800);
    await before.autosave.stop();

    const after = setup({ server, store });
    expect(await after.autosave.start(stale)).toEqual({ kind: "current", data: d(1) });
    after.autosave.change(d(2));
    await advance(800);
    expect(server.requests).toHaveLength(2);
    expect(server.data).toEqual(d(2));
  });

  it("sets an unreadable local copy aside instead of applying or deleting it", async () => {
    const store = createMemoryStore<unknown>();
    await store.put(KEY, { v: 99, data: "from a future app version" });
    const { server, autosave } = setup({ store });
    expect(await autosave.start(server.copy())).toEqual({ kind: "current", data: d(0), setAside: true });
    expect((await store.keys()).filter((key) => key.startsWith("unreadable:"))).toHaveLength(1);
  });
});

describe("autosave: flush before submit", () => {
  it("saves at once and resolves when the server has everything", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    expect(await autosave.flush()).toEqual({ ok: true });

    autosave.change(d(1));
    const flushed = autosave.flush();
    await advance(0);
    expect(await flushed).toEqual({ ok: true });
    expect(server.requests).toHaveLength(1);
  });

  it("also sends what changed while a save was in flight", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.hold();
    autosave.change(d(1));
    await advance(800);
    autosave.change(d(2));
    const flushed = autosave.flush();
    server.release();
    await advance(0);
    expect(await flushed).toEqual({ ok: true });
    expect(server.data).toEqual(d(2));
  });

  it("reports an outage instead of waiting it out, and keeps retrying in the background", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.reachable = false;
    autosave.change(d(1));
    const flushed = autosave.flush();
    await advance(0);
    expect(await flushed).toMatchObject({ ok: false, reason: "network" });
    expect(autosave.getSnapshot()).toMatchObject({ status: "offline", retryAt: Date.now() + 1000 });
  });

  it("gives up after its timeout when a request hangs", async () => {
    const { server, autosave } = setup();
    await autosave.start(server.copy());
    server.hold();
    autosave.change(d(1));
    const flushed = autosave.flush({ timeoutMs: 5000 });
    await advance(5000);
    expect(await flushed).toMatchObject({ ok: false, reason: "timeout" });
    server.release();
  });
});

describe("autosave: local copy problems and stopping", () => {
  it("shows an error when changes can be kept neither on this device nor on the server", async () => {
    const memory = createMemoryStore<unknown>();
    const full: KeyValueStore<unknown> = {
      ...memory,
      put: async () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    const { server, autosave } = setup({ store: full });
    await autosave.start(server.copy());
    autosave.change(d(1));
    await advance(0);
    expect(autosave.getSnapshot()).toMatchObject({ status: "saving", localCopy: false });

    server.reachable = false;
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: { reason: "storage" } });

    server.reachable = true;
    await advance(1000);
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", localCopy: false });
  });

  it("never writes over a local copy it could not read", async () => {
    const memory = createMemoryStore<unknown>();
    const writes: string[] = [];
    const unreadable: KeyValueStore<unknown> = {
      ...memory,
      get: async () => {
        throw new DOMException("Connection to Indexed Database server lost.", "UnknownError");
      },
      put: async (key) => {
        writes.push(key);
      },
    };
    const { server, autosave } = setup({ store: unreadable });
    expect(await autosave.start(server.copy())).toEqual({ kind: "current", data: d(0) });
    autosave.change(d(1));
    await advance(800);
    expect(writes).toEqual([]);
    expect(server.data).toEqual(d(1));
    expect(autosave.getSnapshot().localCopy).toBe(false);
  });

  it("on the in-memory fallback, says a reload would lose changes the server does not have yet", async () => {
    const { server, autosave } = setup({ persistent: false });
    await autosave.start(server.copy());
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", localCopy: false });

    server.reachable = false;
    autosave.change(d(1));
    await advance(800);
    expect(autosave.getSnapshot()).toMatchObject({ status: "error", error: { reason: "storage" }, localCopy: false });

    server.reachable = true;
    await advance(1000);
    expect(autosave.getSnapshot()).toMatchObject({ status: "saved", error: null });
  });

  it("stop() keeps unsaved changes for the next start and ignores later signals", async () => {
    const { server, store, net, autosave } = setup();
    await autosave.start(server.copy());
    server.reachable = false;
    autosave.change(d(1));
    await advance(800);
    await autosave.stop();

    expect(() => autosave.change(d(2))).toThrow(/stopped/);
    net.set(false);
    net.set(true);
    await advance(60_000);
    expect(server.requests).toHaveLength(1);
    expect(await autosave.flush()).toMatchObject({ ok: false, reason: "stopped" });
    expect(await store.get(KEY)).toMatchObject({ data: d(1), revision: 1, syncedRevision: 0 });
  });

  it("sends nothing and arms no timer when stopped while the local copy is written before a send", async () => {
    const memory = createMemoryStore<unknown>();
    let gate: (() => void) | null = null;
    const slow: KeyValueStore<unknown> = {
      ...memory,
      put: async (key, value) => {
        if (key === KEY && gate === null) await new Promise<void>((resolve) => (gate = resolve));
        return memory.put(key, value);
      },
    };
    const { server, autosave } = setup({ store: slow });
    await autosave.start(server.copy());
    autosave.change(d(1));
    await advance(800);
    expect(gate).not.toBeNull();

    const stopped = autosave.stop();
    (gate as unknown as () => void)();
    await advance(0);
    await stopped;
    expect(server.requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(await memory.get(KEY)).toMatchObject({ data: d(1), revision: 1, syncedRevision: 0 });
  });
});

describe("autosave: one writer per inspection on a device", () => {
  it("keeps a second tab read-only while the first one is editing (Web Locks)", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const lock = pageLock();
    const first = setup({ server, store, lock });
    await first.autosave.start(server.copy());
    first.autosave.change(d(1));
    await advance(800);

    const second = setup({ server, store, lock });
    const starting = second.autosave.start(server.copy());
    await advance(AUTOSAVE_LOCK_WAIT_MS);
    expect(await starting).toEqual({ kind: "busy", data: d(1) });
    expect(second.autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: { reason: "other_tab", message: BUSY_MESSAGE },
      localCopy: false,
    });
    expect(() => second.autosave.change(d(9))).toThrow(BUSY_MESSAGE);
    expect(await second.autosave.flush()).toMatchObject({ ok: false, reason: "other_tab" });
    await second.autosave.stop();

    // Once the first tab lets go (closed, or its screen left), the next one takes over its copy.
    first.autosave.change(d(2));
    await first.autosave.stop();
    const third = setup({ server, store, lock });
    expect(await third.autosave.start(server.copy())).toMatchObject({ kind: "restored", data: d(2) });
    await advance(0);
    expect(server.data).toEqual(d(2));
  });

  it("lets a screen replaced in the same tab finish its last write first, and never write after it", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    const lock = pageLock();
    const first = setup({ server, store, lock });
    await first.autosave.start(server.copy());
    first.autosave.change(d(1));
    server.hold();
    await advance(800);
    expect(server.requests).toHaveLength(1);
    const stopping = first.autosave.stop();

    // The new screen's requests never come back, so its local copy stays unsynced.
    const silent: AutosaveTransport<Data> = { save: () => new Promise(() => undefined) };
    const second = setup({ server, store, lock, transport: silent });
    expect(await second.autosave.start(server.copy())).toMatchObject({ kind: "restored", data: d(1) });
    await stopping;
    second.autosave.change(d(2));
    await advance(0);

    // The first screen's request lands and answers late: its answer must not touch the local copy.
    server.release();
    await advance(0);
    expect(server.data).toEqual(d(1));
    expect(await store.get(KEY)).toMatchObject({ data: d(2), revision: 2, syncedRevision: 0 });

    // The page dies; the next start keeps d(2), recognising d(1) on the server as this device's own save.
    const third = setup({ server, store });
    expect(await third.autosave.start(server.copy())).toMatchObject({ kind: "restored", data: d(2) });
    await advance(0);
    expect(server.data).toEqual(d(2));
  });

  it("hands the lock over only after its last write, so the next screen sees every change", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const memory = createMemoryStore<unknown>();
    let gate: (() => void) | null = null;
    let slow = false;
    const store: KeyValueStore<unknown> = {
      ...memory,
      put: async (key, value) => {
        if (slow) await new Promise<void>((resolve) => (gate = resolve));
        return memory.put(key, value);
      },
    };
    const lock = pageLock();
    const first = setup({ server, store, lock });
    await first.autosave.start(server.copy());
    await advance(0);
    slow = true;
    first.autosave.change(d(1));
    await advance(0);
    // d(2) waits behind the write of d(1) when the screen goes.
    first.autosave.change(d(2));
    const stopping = first.autosave.stop();

    const second = setup({ server, store, lock });
    const starting = second.autosave.start(server.copy());
    await advance(0);
    slow = false;
    (gate as unknown as () => void)();
    await stopping;
    expect(await starting).toMatchObject({ kind: "restored", data: d(2) });
  });

  it("never lets an answer that arrives after stop() touch the local copy", async () => {
    const { server, store, autosave } = setup();
    await autosave.start(server.copy());
    autosave.change(d(1));
    server.hold();
    await advance(800);
    await autosave.stop();
    const atStop = await store.get(KEY);
    expect(atStop).toMatchObject({ data: d(1), revision: 1, syncedRevision: 0 });

    server.release();
    await advance(0);
    expect(server.data).toEqual(d(1));
    expect(await store.get(KEY)).toEqual(atStop);
  });

  it("without Web Locks, never writes over another tab's unsynced copy, and asks on the next start", async () => {
    const server = new FakeInspectionServer<Data>(d(0));
    const store = createMemoryStore<unknown>();
    // Separate locks: no lock spans the tabs (an insecure origin).
    const tabA = setup({ server, store });
    // Tab B's requests never get through.
    const tabB = setup({
      server,
      store,
      transport: {
        save: async () => {
          throw new TypeError("Load failed");
        },
      },
    });
    await tabA.autosave.start(server.copy());
    await advance(0);
    await tabB.autosave.start(server.copy());
    await advance(0);

    // Tab B is edited while it has no connection, then goes to the background.
    const typedInB: Data = { modules: { weight: { values: [9.1, 9.2, 9.3] } } };
    tabB.autosave.change(typedInB);
    await advance(800);
    expect(tabB.autosave.getSnapshot().status).toBe("offline");

    // Tab A is edited next: it finds tab B's copy and steps back instead of writing over it.
    tabA.autosave.change(d(1));
    await advance(0);
    expect(tabA.autosave.getSnapshot()).toMatchObject({
      status: "error",
      error: { reason: "other_tab", message: SUPERSEDED_MESSAGE },
      localCopy: false,
    });
    expect(await store.get(KEY)).toMatchObject({ data: typedInB, syncedRevision: 0 });
    expect(await listUnsavedDrafts(store, USER)).toHaveLength(1);

    // It still saves to the server, where compare-and-set keeps both sides honest, but it cannot submit.
    await advance(800);
    expect(server.data).toEqual(d(1));
    expect(await tabA.autosave.flush()).toMatchObject({ ok: false, reason: "other_tab" });

    // iPadOS discards tab B. On the next start both versions exist and the inspector chooses.
    const reload = setup({ server, store });
    expect(await reload.autosave.start(server.copy())).toMatchObject({
      kind: "conflict",
      local: { data: typedInB },
      server: { data: d(1) },
    });
  });
});
