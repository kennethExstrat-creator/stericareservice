import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_QUEUE_STATE, type PhotoQueueState } from "@/components/capture/photos/queue-state";
import { draftKey } from "@/lib/offline/drafts";
import { createMemoryStore } from "@/lib/offline/kv";
import type { UploadItem, UploadQueue } from "@/lib/photos/upload-queue";
import {
  discardLocalCopies,
  discardQueuedUploads,
  forgetDeletedDraft,
  QUEUE_WAIT_MS,
  type UploadQueueStore,
} from "./forget-deleted-draft";

// The page's real queue and database need a browser; forgetDeletedDraft gets these instead.
const page = vi.hoisted(() => ({
  store: { start: vi.fn(), subscribe: vi.fn(), getSnapshot: vi.fn(), remove: vi.fn() },
  getOfflineDatabase: vi.fn(),
}));
vi.mock("@/components/capture/photos/queue-store", () => ({ photoQueueStore: page.store }));
vi.mock("@/lib/offline/db", () => ({ getOfflineDatabase: page.getOfflineDatabase }));

const USER = "user-1";
const DELETED = "insp-deleted";
const OTHER = "insp-other";

function item(id: string, inspectionId: string): UploadItem {
  return {
    id,
    kind: "photo",
    inspectionId,
    moduleKey: "glove_info",
    target: null,
    caption: null,
    name: null,
    flagged: false,
    takenAt: null,
    state: "waiting",
    progress: 0,
    error: null,
    createdAt: 0,
  };
}

/** A stand-in for the page's queue store: its state, changed by the test, and the removals it was asked for. */
function fakeStore(initial: { load?: "loading" | "ready" | "failed"; items?: UploadItem[]; preparing?: PhotoQueueState["preparing"] }) {
  let state: PhotoQueueState = {
    ...INITIAL_QUEUE_STATE,
    phase: "ready",
    userId: USER,
    preparing: initial.preparing ?? {},
    queue: { ...INITIAL_QUEUE_STATE.queue, load: initial.load ?? "ready", items: initial.items ?? [] },
  };
  const listeners = new Set<() => void>();
  const removed: string[] = [];
  const store: UploadQueueStore = {
    start: vi.fn(async (userId: string) => (userId === USER ? ({} as UploadQueue) : null)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    remove: vi.fn(async (id: string) => {
      removed.push(id);
      return true;
    }),
  };
  function change(patch: { load?: "loading" | "ready" | "failed"; items?: UploadItem[]; preparing?: PhotoQueueState["preparing"] }) {
    state = {
      ...state,
      preparing: patch.preparing ?? state.preparing,
      queue: { ...state.queue, load: patch.load ?? state.queue.load, items: patch.items ?? state.queue.items },
    };
    for (const listener of [...listeners]) listener();
  }
  return { store, change, removed, listeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("discardQueuedUploads", () => {
  it("takes out only the deleted draft's items, starting the queue for the user who deleted it", async () => {
    const { store, removed } = fakeStore({ items: [item("a", DELETED), item("b", OTHER), item("c", DELETED)] });
    await expect(discardQueuedUploads(store, { userId: USER, inspectionId: DELETED })).resolves.toEqual({
      discarded: 2,
      complete: true,
    });
    expect(store.start).toHaveBeenCalledWith(USER);
    expect(removed).toEqual(["a", "c"]);
  });

  it("waits until the queue has read what this device kept", async () => {
    const { store, change, removed, listeners } = fakeStore({ load: "loading" });
    const outcome = discardQueuedUploads(store, { userId: USER, inspectionId: DELETED });
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    expect(removed).toEqual([]);
    change({ load: "ready", items: [item("kept-earlier", DELETED), item("b", OTHER)] });
    await expect(outcome).resolves.toEqual({ discarded: 1, complete: true });
    expect(removed).toEqual(["kept-earlier"]);
    expect(listeners.size).toBe(0);
  });

  it("waits for photos still being prepared for the draft, so none is queued after the rest have gone", async () => {
    const { store, change, removed, listeners } = fakeStore({
      items: [item("a", DELETED)],
      preparing: { [DELETED]: { photos: 1, files: 0 } },
    });
    const outcome = discardQueuedUploads(store, { userId: USER, inspectionId: DELETED });
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    // Photos being prepared for another inspection do not hold it up.
    change({
      items: [item("a", DELETED), item("just-taken", DELETED)],
      preparing: { [DELETED]: { photos: 0, files: 0 }, [OTHER]: { photos: 3, files: 0 } },
    });
    await expect(outcome).resolves.toEqual({ discarded: 2, complete: true });
    expect(removed).toEqual(["a", "just-taken"]);
  });

  it("stops waiting after the time limit, takes out what it knows and says some may be left", async () => {
    vi.useFakeTimers();
    const { store, removed, listeners } = fakeStore({ load: "failed", items: [item("queued-here", DELETED)] });
    const outcome = discardQueuedUploads(store, { userId: USER, inspectionId: DELETED });
    await vi.waitFor(() => expect(listeners.size).toBe(1));
    await vi.advanceTimersByTimeAsync(QUEUE_WAIT_MS);
    await expect(outcome).resolves.toEqual({ discarded: 1, complete: false });
    expect(removed).toEqual(["queued-here"]);
    expect(listeners.size).toBe(0);
  });

  it("reaches nothing when no queue can run for the user", async () => {
    const { store } = fakeStore({ items: [item("a", DELETED)] });
    await expect(discardQueuedUploads(store, { userId: "someone-else", inspectionId: DELETED })).resolves.toEqual({
      discarded: 0,
      complete: false,
    });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("goes on past an item it cannot take out, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { store } = fakeStore({ items: [item("a", DELETED), item("b", DELETED)] });
    vi.mocked(store.remove).mockRejectedValueOnce(new Error("IndexedDB is closing"));
    await expect(discardQueuedUploads(store, { userId: USER, inspectionId: DELETED })).resolves.toEqual({
      discarded: 1,
      complete: false,
    });
    expect(store.remove).toHaveBeenCalledWith("b");
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("discardLocalCopies", () => {
  it("removes the user's local copy of the draft and any set-aside copy of it, nothing else", async () => {
    const drafts = createMemoryStore<unknown>();
    const keep = [draftKey({ userId: USER, inspectionId: OTHER }), draftKey({ userId: "user-2", inspectionId: DELETED })];
    for (const key of [...keep, draftKey({ userId: USER, inspectionId: DELETED })]) await drafts.put(key, { any: "copy" });
    await drafts.put(`unreadable:${USER}:${DELETED}:1700000000000`, { older: true });
    await drafts.put(`unreadable:${USER}:${OTHER}:1700000000000`, { older: true });

    await discardLocalCopies(drafts, { userId: USER, inspectionId: DELETED });

    expect(await drafts.keys()).toEqual([...keep, `unreadable:${USER}:${OTHER}:1700000000000`].sort());
  });
});

describe("forgetDeletedDraft", () => {
  it("clears the page's queue and the local database for the draft", async () => {
    const queue = fakeStore({ items: [item("a", DELETED), item("b", OTHER)] });
    Object.assign(page.store, queue.store);
    const drafts = createMemoryStore<unknown>();
    await drafts.put(draftKey({ userId: USER, inspectionId: DELETED }), { any: "copy" });
    page.getOfflineDatabase.mockResolvedValue({ store: () => drafts });

    await forgetDeletedDraft({ userId: USER, inspectionId: DELETED });

    expect(queue.removed).toEqual(["a"]);
    expect(await drafts.keys()).toEqual([]);
  });

  it("never fails: the deletion went through, so a problem here is only logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.assign(page.store, { start: vi.fn().mockRejectedValue(new Error("no IndexedDB")) });
    page.getOfflineDatabase.mockRejectedValue(new Error("no IndexedDB"));

    await expect(forgetDeletedDraft({ userId: USER, inspectionId: DELETED })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("warns when queued uploads may be left on the device", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.assign(page.store, { start: vi.fn().mockResolvedValue(null) });
    page.getOfflineDatabase.mockResolvedValue({ store: () => createMemoryStore<unknown>() });

    await forgetDeletedDraft({ userId: USER, inspectionId: DELETED });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(DELETED), { discarded: 0, complete: false });
  });
});
