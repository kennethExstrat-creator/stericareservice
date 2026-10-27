import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/inspections/photos/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inspections/photos/queries")>()),
  loadInspectionMedia: vi.fn(),
  loadPhotos: vi.fn(),
  loadFiles: vi.fn(),
  signPaths: vi.fn(),
}));

/** The page's upload queue, as far as the media stores use it: its user, finished uploads, and their copies on screen. */
const queue = vi.hoisted(() => {
  const state: { userId: string | null } = { userId: null };
  const listeners = new Set<() => void>();
  let settledListener: ((items: readonly unknown[]) => void) | null = null;
  return {
    state,
    /** What the queue hands over when uploads finish. */
    settle: (items: readonly unknown[]) => settledListener?.(items),
    /** The queue's state changed (e.g. its user). */
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    store: {
      onSettled: (listener: (items: readonly unknown[]) => void) => {
        settledListener = listener;
        return () => undefined;
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      forgetSettled: vi.fn(),
      patchSettled: vi.fn((): boolean => false),
    },
  };
});
vi.mock("./queue-store", () => ({ photoQueueStore: queue.store }));

import {
  loadFiles,
  loadInspectionMedia,
  loadPhotos,
  MEDIA_MESSAGES,
  signPaths,
  type InspectionMedia,
  type MediaLoad,
} from "@/lib/inspections/photos/queries";
import { EMPTY_TAG_OPTIONS, type MediaFile, type MediaPhoto } from "@/lib/inspections/photos/view";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { InspectionMediaStore, mediaStore, REFRESH_AFTER_MS } from "./media-store";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const OTHER_INSPECTION = "9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a";

function photo(id: string, patch: Partial<MediaPhoto> = {}): MediaPhoto {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey: "dimensions",
    target: null,
    caption: null,
    takenAt: null,
    width: 2048,
    height: 1536,
    flagged: false,
    includeInReport: false,
    createdBy: "inspector",
    createdAt: "2026-10-06T01:14:05.123456+00:00",
    storagePath: `${INSPECTION}/${id}.jpg`,
    thumbPath: `${INSPECTION}/thumbs/${id}.jpg`,
    thumbUrl: `https://old/thumb/${id}`,
    fullUrl: `https://old/full/${id}`,
    description: null,
    describedAt: null,
    ...patch,
  };
}

const file: MediaFile = {
  id: "f1",
  inspectionId: INSPECTION,
  moduleKey: "tensile",
  kind: "lab_report",
  name: "Tensile.pdf",
  createdBy: "inspector",
  createdAt: "2026-10-06T01:14:05.123456+00:00",
  storagePath: `${INSPECTION}/f1.pdf`,
  url: "https://old/f1",
};

function media(photos: MediaPhoto[], signedAt = 1_000, files: MediaFile[] = [], patch: Partial<InspectionMedia> = {}): InspectionMedia {
  return {
    inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: "inspector" },
    access: { canEdit: true, isAdmin: false },
    photos,
    files,
    options: EMPTY_TAG_OPTIONS,
    signedAt,
    problems: [],
    ...patch,
  };
}

const item = (id: string, kind: "photo" | "file", inspectionId = INSPECTION): UploadItem => ({
  id,
  kind,
  inspectionId,
  moduleKey: "dimensions",
  target: null,
  caption: null,
  name: null,
  flagged: false,
  takenAt: null,
  state: "uploading",
  progress: 1,
  error: null,
  createdAt: 1,
});

/** A promise the test settles itself: a request still on its way. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const photoIds = (store: InspectionMediaStore) => store.getSnapshot().media?.photos.map((entry) => entry.id);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [], complete: true });
  vi.mocked(loadFiles).mockResolvedValue({ ok: true, files: [], complete: true });
  queue.store.forgetSettled.mockClear();
  queue.store.patchSettled.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(loadInspectionMedia).mockReset();
  vi.mocked(loadPhotos).mockReset();
  vi.mocked(loadFiles).mockReset();
  vi.mocked(signPaths).mockReset();
  vi.restoreAllMocks();
});

describe("seed: the gallery's server copy", () => {
  it("takes the server's copy, quietly while React renders, and tells subscribers on notify()", () => {
    const store = new InspectionMediaStore(INSPECTION);
    const listener = vi.fn();
    store.subscribe(listener);
    store.seed(media([photo("a")]), { silent: true });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "a" }] } });
    store.notify();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("takes a copy once: the same copy again (a re-render) or an older one (a page restored on Back) keeps what the page has since", () => {
    const store = new InspectionMediaStore(INSPECTION);
    const first = media([photo("a")], 2_000);
    store.seed(first);
    store.applyPhoto({ id: "a", moduleKey: "visual", target: null, caption: "Retagged here", includeInReport: false });
    store.seed(first);
    store.seed(media([photo("old")], 1_000));
    expect(store.getSnapshot().media?.photos).toEqual([expect.objectContaining({ id: "a", caption: "Retagged here" })]);
    store.seed(media([photo("newer")], 3_000));
    expect(photoIds(store)).toEqual(["newer"]);
  });

  it("compares server copies on the server's clock: links signed again on a device whose clock runs ahead never hide a newer copy", async () => {
    vi.useFakeTimers({ now: 50_000_000 });
    vi.mocked(signPaths).mockImplementation(async (_client, _bucket, paths) => ({ urls: new Map(paths.map((path) => [path, `https://new/${path}`])), complete: true }));
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")], 1_000));
    await store.resign();
    expect(store.getSnapshot().media?.signedAt).toBe(50_000_000);
    store.seed(media([photo("a"), photo("b")], 2_000));
    expect(photoIds(store)).toEqual(["a", "b"]);
  });
});

describe("load", () => {
  it("loads once, shows loading meanwhile, and does not load again once ready", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValue({ kind: "ok", media: media([photo("a")]) });
    const store = new InspectionMediaStore(INSPECTION);
    store.ensureLoaded();
    expect(store.getSnapshot().status).toBe("loading");
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
    store.ensureLoaded();
    expect(loadInspectionMedia).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadInspectionMedia).mock.calls[0][1]).toBe(INSPECTION);
  });

  it("answers an inspection the user may not read as not found", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValue({ kind: "not_found" });
    const store = new InspectionMediaStore(INSPECTION);
    await store.load();
    expect(store.getSnapshot()).toEqual({ status: "not_found", media: null, error: null });
  });

  it("shows a failed first load, and retries it only after a pause", async () => {
    vi.useFakeTimers();
    vi.mocked(loadInspectionMedia).mockResolvedValue({ kind: "error", message: "The photos could not be loaded." });
    const store = new InspectionMediaStore(INSPECTION);
    await store.load();
    expect(store.getSnapshot()).toEqual({ status: "error", media: null, error: "The photos could not be loaded." });
    store.ensureLoaded();
    expect(loadInspectionMedia).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    store.ensureLoaded();
    expect(loadInspectionMedia).toHaveBeenCalledTimes(2);
  });

  it("keeps what it has when a reload fails or throws", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "error", message: "offline" });
    await store.load();
    vi.mocked(loadInspectionMedia).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "a" }] } });
  });

  it("can load again after a load that failed at once", async () => {
    vi.mocked(loadInspectionMedia).mockImplementationOnce(() => {
      throw new Error("Supabase is not configured");
    });
    const store = new InspectionMediaStore(INSPECTION);
    await store.load();
    expect(store.getSnapshot().status).toBe("error");
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "ok", media: media([photo("a")]) });
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "a" }] } });
  });
});

describe("finished uploads: never missing from the screen", () => {
  it("adds the rows the queue just finished, with their URLs, and only then stops the queue showing its copy", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")], 1_000, []));
    const order: string[] = [];
    store.subscribe(() => order.push("rows in"));
    queue.store.forgetSettled.mockImplementation(() => order.push("queue copy gone"));
    vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [photo("b", { thumbUrl: "https://new/thumb/b" })], complete: true });
    vi.mocked(loadFiles).mockResolvedValue({ ok: true, files: [file], complete: true });
    await store.takeUploaded([item("b", "photo"), item("f1", "file")]);
    expect(vi.mocked(loadPhotos).mock.calls[0][1]).toEqual(["b"]);
    expect(vi.mocked(loadFiles).mock.calls[0][1]).toEqual(["f1"]);
    const current = store.getSnapshot().media;
    expect(current?.photos.map((entry) => [entry.id, entry.thumbUrl])).toEqual([
      ["a", "https://old/thumb/a"],
      ["b", "https://new/thumb/b"],
    ]);
    expect(current?.files).toEqual([file]);
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["b", "f1"]);
    expect(order).toEqual(["rows in", "queue copy gone"]);
  });

  it("keeps the queue's copy on screen while the read fails, and reads again with backoff", async () => {
    vi.useFakeTimers();
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    vi.mocked(loadPhotos).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, photos: [photo("b")], complete: true });
    await store.takeUploaded([item("b", "photo")]);
    expect(photoIds(store)).toEqual(["a"]);
    expect(queue.store.forgetSettled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadPhotos).toHaveBeenCalledTimes(2);
    expect(photoIds(store)).toEqual(["a", "b"]);
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["b"]);
  });

  it("reads again as soon as the connection returns", async () => {
    vi.stubGlobal("window", new EventTarget());
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    store.subscribe(() => undefined);
    vi.mocked(loadPhotos).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, photos: [photo("b")], complete: true });
    await store.takeUploaded([item("b", "photo")]);
    expect(photoIds(store)).toEqual(["a"]);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(photoIds(store)).toEqual(["a", "b"]));
  });

  it("stops showing the queue's copy of an upload whose row is gone (deleted meanwhile)", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    await store.takeUploaded([item("b", "photo")]);
    expect(photoIds(store)).toEqual(["a"]);
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["b"]);
  });

  it("waits for a load in flight, which may have read the rows just before they went in", async () => {
    const load = deferred<MediaLoad>();
    vi.mocked(loadInspectionMedia).mockReturnValue(load.promise);
    vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [photo("b")], complete: true });
    const store = new InspectionMediaStore(INSPECTION);
    const loading = store.load();
    const taking = store.takeUploaded([item("b", "photo")]);
    load.resolve({ kind: "ok", media: media([photo("a")]) });
    await Promise.all([loading, taking]);
    expect(photoIds(store)).toEqual(["a", "b"]);
  });

  it("loads everything when uploads finish before the first load worked (a page opened offline)", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "error", message: "offline" });
    const store = new InspectionMediaStore(INSPECTION);
    await store.load();
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "ok", media: media([photo("b")]) });
    await store.takeUploaded([item("b", "photo")]);
    expect(loadPhotos).not.toHaveBeenCalled();
    expect(loadInspectionMedia).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "b" }] } });
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["b"]);
  });

  it("shows a retag of an upload whose row is not read yet at once, and reads the row again after it", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    // The first read left before the retag: it brings the row as it was.
    const firstRead = deferred<Awaited<ReturnType<typeof loadPhotos>>>();
    vi.mocked(loadPhotos)
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce({ ok: true, photos: [photo("b", { caption: "Retagged" })], complete: true });
    const taking = store.takeUploaded([item("b", "photo")]);
    await vi.waitFor(() => expect(loadPhotos).toHaveBeenCalledTimes(1));

    queue.store.patchSettled.mockReturnValue(true);
    const change = { id: "b", moduleKey: "visual", target: null, caption: "Retagged", includeInReport: false };
    store.applyPhoto(change);
    expect(queue.store.patchSettled).toHaveBeenCalledWith(change);

    firstRead.resolve({ ok: true, photos: [photo("b")], complete: true });
    await taking;
    expect(loadPhotos).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().media?.photos[1]).toMatchObject({ id: "b", caption: "Retagged" });
    // The queue's copy went once, after the read that followed the retag.
    expect(queue.store.forgetSettled).toHaveBeenCalledTimes(1);
  });

  it("never brings back a photo deleted on this page while its row was being read", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    const read = deferred<Awaited<ReturnType<typeof loadPhotos>>>();
    vi.mocked(loadPhotos).mockReturnValueOnce(read.promise);
    const taking = store.takeUploaded([item("b", "photo")]);
    await vi.waitFor(() => expect(loadPhotos).toHaveBeenCalledTimes(1));
    store.removePhoto("b");
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["b"]);
    read.resolve({ ok: true, photos: [photo("b")], complete: true });
    await taking;
    expect(photoIds(store)).toEqual(["a"]);
  });

  it("signs again soon when some links of the new rows could not be signed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    vi.mocked(signPaths).mockImplementation(async (_client, _bucket, paths) => ({ urls: new Map(paths.map((path) => [path, `https://new/${path}`])), complete: true }));
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    store.subscribe(() => undefined);
    vi.mocked(loadPhotos).mockResolvedValueOnce({ ok: true, photos: [photo("b", { thumbUrl: null, fullUrl: null })], complete: false });
    await store.takeUploaded([item("b", "photo")]);
    expect(signPaths).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(signPaths).toHaveBeenCalled();
    expect(store.getSnapshot().media?.photos[1]).toMatchObject({ id: "b", fullUrl: `https://new/${INSPECTION}/b.jpg` });
  });

  it("routes each finished item to the store of its inspection, and lets go of those no screen here shows", async () => {
    const store = mediaStore(INSPECTION);
    const other = mediaStore(OTHER_INSPECTION);
    expect(mediaStore(INSPECTION)).toBe(store);
    const take = vi.spyOn(store, "takeUploaded").mockResolvedValue();
    const takeOther = vi.spyOn(other, "takeUploaded").mockResolvedValue();
    const unseen = "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e";
    queue.settle([item("a", "photo"), item("x", "photo", OTHER_INSPECTION), item("f", "file"), item("z", "photo", unseen)]);
    expect(take).toHaveBeenCalledWith([item("a", "photo"), item("f", "file")]);
    expect(takeOther).toHaveBeenCalledWith([item("x", "photo", OTHER_INSPECTION)]);
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["z"]);
  });
});

describe("changes from the actions", () => {
  it("applies a retag or report choice, and removes deleted photos and files", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a"), photo("b")], 1_000, [file]));
    store.applyPhoto({ id: "b", moduleKey: "visual", target: "size:M", caption: "Stain", includeInReport: true });
    expect(store.getSnapshot().media?.photos[1]).toMatchObject({
      id: "b",
      moduleKey: "visual",
      target: "size:M",
      caption: "Stain",
      includeInReport: true,
      thumbUrl: "https://old/thumb/b",
    });
    store.removePhoto("a");
    store.removeFile("f1");
    expect(photoIds(store)).toEqual(["b"]);
    expect(store.getSnapshot().media?.files).toEqual([]);
  });

  it("tells nobody when a removed photo was not there, and still drops any copy the queue shows", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    const listener = vi.fn();
    store.subscribe(listener);
    store.removePhoto("missing");
    expect(listener).not.toHaveBeenCalled();
    expect(queue.store.forgetSettled).toHaveBeenCalledWith(["missing"]);
  });

  // docs/AI.md, "Describing photos": the Report page's preview follows each batch at once.
  it("takes Steri-AI's descriptions, keeping everything else, and tells nobody about photos it does not have", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a"), photo("b", { caption: "Mine" })]));
    const listener = vi.fn();
    store.subscribe(listener);
    const pinhole = { text: "Pinhole, palm area", kind: "defect" as const, defect: "hole_palm", location: "hole_palm", clarity: 0.9, check: "watertight" as const };
    store.applyDescriptions([
      { id: "b", description: pinhole, describedAt: "2026-10-27T02:00:00Z" },
      { id: "missing", description: null, describedAt: "2026-10-27T02:00:00Z" },
    ]);
    expect(store.getSnapshot().media?.photos).toEqual([
      expect.objectContaining({ id: "a", description: null, describedAt: null }),
      expect.objectContaining({ id: "b", caption: "Mine", description: pinhole, describedAt: "2026-10-27T02:00:00Z", thumbUrl: "https://old/thumb/b" }),
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.applyDescriptions([{ id: "missing", description: null, describedAt: "2026-10-27T02:00:00Z" }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("shown again after client-side navigation", () => {
  it("loads an older copy again in the background, keeping it on screen meanwhile", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    vi.stubGlobal("window", new EventTarget());
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")], 1_000, [], { access: { canEdit: false, isAdmin: false } }));
    const unsubscribe = store.subscribe(() => undefined);
    expect(loadInspectionMedia).not.toHaveBeenCalled();
    unsubscribe();

    // Elsewhere meanwhile: a photo added on another device, the inspection reopened.
    vi.advanceTimersByTime(REFRESH_AFTER_MS + 1);
    const load = deferred<MediaLoad>();
    vi.mocked(loadInspectionMedia).mockReturnValueOnce(load.promise);
    store.subscribe(() => undefined);
    expect(loadInspectionMedia).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "a" }] } });

    load.resolve({
      kind: "ok",
      media: media([photo("a", { thumbUrl: "https://new/thumb/a" }), photo("c", { thumbUrl: "https://new/thumb/c" })], 2_000),
    });
    await vi.waitFor(() => expect(photoIds(store)).toEqual(["a", "c"]));
    expect(store.getSnapshot().media?.access.canEdit).toBe(true);
    // The links already on screen stay while they last: no thumbnail loads twice.
    expect(store.getSnapshot().media?.photos.map((entry) => entry.thumbUrl)).toEqual(["https://old/thumb/a", "https://new/thumb/c"]);
  });

  it("does not load again right after the gallery handed its copy over", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]), { silent: true });
    store.subscribe(() => undefined);
    store.ensureLoaded();
    expect(loadInspectionMedia).not.toHaveBeenCalled();
  });

  it("drops the signing problem once every link is signed again", async () => {
    vi.mocked(signPaths).mockImplementation(async (_client, _bucket, paths) => ({ urls: new Map(paths.map((path) => [path, `https://new/${path}`])), complete: true }));
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a", { thumbUrl: null })], 1_000, [], { problems: [MEDIA_MESSAGES.signFailed] }));
    await store.resign();
    expect(store.getSnapshot().media).toMatchObject({ problems: [], photos: [{ thumbUrl: `https://new/${INSPECTION}/thumbs/a.jpg` }] });
  });
});

describe("another user on the page", () => {
  it("reset() forgets the copy and loads again for the screens still showing it", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")], 1_000, [], { access: { canEdit: false, isAdmin: true } }));
    const states: string[] = [];
    store.subscribe(() => states.push(store.getSnapshot().status));
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "ok", media: media([photo("a")], 2_000) });
    store.reset();
    expect(states).toEqual(["idle", "loading"]);
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    expect(store.getSnapshot().media?.access).toEqual({ canEdit: true, isAdmin: false });
  });

  it("drops answers to requests the earlier user made", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    const earlier = deferred<MediaLoad>();
    vi.mocked(loadInspectionMedia).mockReturnValueOnce(earlier.promise);
    const loading = store.load();
    store.reset();
    earlier.resolve({ kind: "ok", media: media([photo("theirs")]) });
    await loading;
    expect(store.getSnapshot()).toEqual({ status: "idle", media: null, error: null });
    // And a new load is not held up by the old one.
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "ok", media: media([photo("mine")]) });
    await store.load();
    expect(photoIds(store)).toEqual(["mine"]);
  });

  it("empties every store when another user signs in on the page, not when the user signs out", () => {
    const store = mediaStore(INSPECTION);
    queue.state.userId = "inspector-a";
    queue.emit();
    store.seed(media([photo("a")], 10_000));
    queue.state.userId = null;
    queue.emit();
    expect(photoIds(store)).toEqual(["a"]);
    queue.state.userId = "inspector-a";
    queue.emit();
    expect(photoIds(store)).toEqual(["a"]);
    queue.state.userId = "inspector-b";
    queue.emit();
    expect(store.getSnapshot()).toEqual({ status: "idle", media: null, error: null });
  });
});
