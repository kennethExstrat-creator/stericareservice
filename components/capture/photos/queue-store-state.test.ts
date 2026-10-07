// The page's upload queue as the screens use it: the submit check
// (BUILD_SPEC 8.1, "submit is blocked until the queue is empty") and the
// finished uploads it keeps on screen until their rows are read. The upload
// queue itself (lib/photos) is a fake here; its own tests cover uploading.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  env: { url: "https://project.supabase.example", publishableKey: "publishable" } as { url: string; publishableKey: string } | null,
  database: null as Promise<unknown> | null,
  session: null as { user: { id: string }; access_token: string } | null,
  queues: [] as unknown[],
  processPhoto: null as ((file: File) => Promise<unknown>) | null,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/env", () => ({ getSupabasePublicEnv: () => fakes.env }));
vi.mock("@/lib/offline/db", () => ({
  getOfflineDatabase: () => fakes.database ?? Promise.resolve({ store: () => ({}), persistent: true }),
  requestPersistentStorage: async () => true,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: fakes.session }, error: null }) } }),
}));
vi.mock("@/lib/photos/supabase-adapters", () => ({ supabaseStorage: () => ({}), supabaseRepository: () => ({}) }));
vi.mock("@/lib/photos/browser-codec", () => ({ browserCodec: () => ({}) }));
vi.mock("@/lib/photos/process", () => ({ processPhoto: (file: File) => fakes.processPhoto!(file) }));
vi.mock("@/lib/photos/upload-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photos/upload-queue")>()),
  createUploadQueue: () => {
    const queue = fakeQueue();
    fakes.queues.push(queue);
    return queue;
  },
}));

import type { UploadItem, UploadQueueSnapshot } from "@/lib/photos/upload-queue";
import { EMPTY_QUEUE_SNAPSHOT, QUEUE_PROBLEMS } from "./queue-state";
import { PhotoQueueStore } from "./queue-store";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const OTHER_INSPECTION = "9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a";
const ME = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const SOMEONE_ELSE = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

type FakeQueue = ReturnType<typeof fakeQueue>;

/** The lib/photos queue as the page store drives it; `show` replaces what it holds. */
function fakeQueue() {
  const listeners = new Set<() => void>();
  let snapshot: UploadQueueSnapshot = { ...EMPTY_QUEUE_SNAPSHOT, load: "ready" };
  return {
    start: vi.fn(async () => undefined),
    enqueuePhoto: vi.fn(async () => "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e"),
    enqueueFile: vi.fn(async () => "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f"),
    retag: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    retryNow: vi.fn(),
    pendingCount: vi.fn(() => 0),
    isEmpty: vi.fn(() => true),
    isEmptyNow: vi.fn<(inspectionId?: string) => Promise<boolean>>(async () => true),
    dismissRetagFailure: vi.fn(),
    preview: vi.fn(async () => null),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    stop: vi.fn(),
    show(items: UploadItem[]) {
      snapshot = { ...snapshot, items, pending: items.length };
      for (const listener of [...listeners]) listener();
    },
  };
}

const item = (id: string, patch: Partial<UploadItem> = {}): UploadItem => ({
  id,
  kind: "photo",
  inspectionId: INSPECTION,
  moduleKey: "dimensions",
  target: null,
  caption: null,
  name: null,
  flagged: false,
  takenAt: null,
  state: "waiting",
  progress: 0,
  error: null,
  createdAt: 1,
  ...patch,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function started(store: PhotoQueueStore, userId = ME): Promise<FakeQueue> {
  await store.start(userId);
  return fakes.queues.at(-1) as FakeQueue;
}

const photoFile = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], "glove.jpg", { type: "image/jpeg" });

beforeEach(() => {
  // The store runs in the browser only.
  vi.stubGlobal("window", new EventTarget());
  fakes.env = { url: "https://project.supabase.example", publishableKey: "publishable" };
  fakes.database = null;
  fakes.session = null;
  fakes.queues = [];
  fakes.processPhoto = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the submit check: photoUploadsSettled", () => {
  it("waits while a photo of the inspection is being prepared; another inspection's does not count", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    const processing = deferred<unknown>();
    fakes.processPhoto = () => processing.promise;
    store.addPhotos({ inspectionId: INSPECTION, files: [photoFile()], tag: { moduleKey: "dimensions", target: {} } });

    expect(await store.isSettled(INSPECTION)).toBe(false);
    expect(await store.isSettled(OTHER_INSPECTION)).toBe(true);
    // Before signing out: anything at all.
    expect(await store.isSettled()).toBe(false);

    processing.resolve({ ok: false, reason: "unreadable", message: "Not a photo." });
    await vi.waitFor(() => expect(store.getSnapshot().preparing).toEqual({}));
    expect(await store.isSettled(INSPECTION)).toBe(true);
    expect(queue.isEmptyNow).toHaveBeenLastCalledWith(INSPECTION);
  });

  it("asks the device's own store, which counts what other tabs queued and what is kept only in memory", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    queue.isEmptyNow.mockResolvedValueOnce(false);
    expect(await store.isSettled(INSPECTION)).toBe(false);
    expect(queue.isEmptyNow).toHaveBeenCalledWith(INSPECTION);
  });

  it("starts the queue from the session when no screen has, before answering", async () => {
    fakes.session = { user: { id: ME }, access_token: "token" };
    const store = new PhotoQueueStore();
    expect(await store.isSettled(INSPECTION)).toBe(true);
    expect(fakes.queues).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", userId: ME });
  });

  it("lets submit go where uploads cannot run at all, and never when signed out or the device store would not open", async () => {
    fakes.env = null;
    const unconfigured = new PhotoQueueStore();
    await unconfigured.start(ME);
    expect(unconfigured.getSnapshot()).toMatchObject({ phase: "unavailable", problem: QUEUE_PROBLEMS.notConfigured });
    expect(await unconfigured.isSettled(INSPECTION)).toBe(true);

    fakes.env = { url: "https://project.supabase.example", publishableKey: "publishable" };
    const signedOut = new PhotoQueueStore();
    expect(await signedOut.isSettled(INSPECTION)).toBe(false);
    expect(signedOut.getSnapshot()).toMatchObject({ phase: "unavailable", problem: QUEUE_PROBLEMS.signedOut });

    fakes.database = Promise.reject(new Error("IndexedDB blocked"));
    fakes.database.catch(() => undefined);
    const broken = new PhotoQueueStore();
    await broken.start(ME);
    expect(broken.getSnapshot()).toMatchObject({ phase: "unavailable", problem: QUEUE_PROBLEMS.failedToStart });
    expect(await broken.isSettled(INSPECTION)).toBe(false);
  });
});

describe("finished uploads stay on screen until their rows are read", () => {
  it("keeps an upload that left the queue as settled, in the same update, and hands it to the media stores", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    const handed = vi.fn();
    store.onSettled(handed);
    queue.show([item("a"), item("b")]);

    // Every state the screens can read has "a" in one list or the other.
    const seen: boolean[] = [];
    store.subscribe(() => {
      const state = store.getSnapshot();
      seen.push(state.queue.items.some((entry) => entry.id === "a") || "a" in state.settled);
    });
    queue.show([item("b")]);
    expect(seen).toEqual([true]);
    expect(store.getSnapshot().settled).toEqual({ a: item("a") });
    expect(handed).toHaveBeenCalledWith([item("a")]);
  });

  it("does not count a photo this page removed as uploaded", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    const handed = vi.fn();
    store.onSettled(handed);
    queue.show([item("a")]);
    queue.remove.mockImplementationOnce(async () => {
      queue.show([]);
      return true;
    });
    expect(await store.remove("a")).toBe(true);
    expect(store.getSnapshot().settled).toEqual({});
    expect(handed).not.toHaveBeenCalled();
  });

  it("shows a retag the server took, and forgets an upload once its row is in", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    queue.show([item("a")]);
    queue.show([]);
    expect(store.patchSettled({ id: "missing", moduleKey: "visual", target: null, caption: null })).toBe(false);
    expect(store.patchSettled({ id: "a", moduleKey: "visual", target: "size:M", caption: "Stain" })).toBe(true);
    expect(store.getSnapshot().settled.a).toMatchObject({ moduleKey: "visual", target: "size:M", caption: "Stain" });

    const before = store.getSnapshot();
    store.forgetSettled(["unknown"]);
    expect(store.getSnapshot()).toBe(before);
    store.forgetSettled(["a"]);
    expect(store.getSnapshot().settled).toEqual({});
  });

  it("drops the earlier user's finished uploads when another user signs in on the page", async () => {
    const store = new PhotoQueueStore();
    const queue = await started(store);
    queue.show([item("a")]);
    queue.show([]);
    expect(Object.keys(store.getSnapshot().settled)).toEqual(["a"]);
    await started(store, SOMEONE_ELSE);
    expect(store.getSnapshot()).toMatchObject({ userId: SOMEONE_ELSE, settled: {} });
  });
});
