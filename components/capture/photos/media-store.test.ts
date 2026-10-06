import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/inspections/photos/queries", () => ({
  loadInspectionMedia: vi.fn(),
  loadPhotos: vi.fn(),
  loadFiles: vi.fn(),
  signPaths: vi.fn(),
}));
vi.mock("./queue-store", () => ({ photoQueueStore: { onSettled: vi.fn(() => () => undefined) } }));

import { loadFiles, loadInspectionMedia, loadPhotos, signPaths, type InspectionMedia } from "@/lib/inspections/photos/queries";
import { EMPTY_TAG_OPTIONS, type MediaFile, type MediaPhoto } from "@/lib/inspections/photos/view";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { InspectionMediaStore, mediaStore } from "./media-store";
import { photoQueueStore } from "./queue-store";

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

function media(photos: MediaPhoto[], signedAt = 1_000, files: MediaFile[] = []): InspectionMedia {
  return {
    inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: "inspector" },
    access: { canEdit: true, isAdmin: false },
    photos,
    files,
    options: EMPTY_TAG_OPTIONS,
    signedAt,
    problems: [],
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

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [] });
  vi.mocked(loadFiles).mockResolvedValue({ ok: true, files: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(loadInspectionMedia).mockReset();
  vi.mocked(loadPhotos).mockReset();
  vi.mocked(loadFiles).mockReset();
  vi.mocked(signPaths).mockReset();
  vi.restoreAllMocks();
});

describe("seed", () => {
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

  it("never replaces a newer copy with an older one", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("new")], 2_000));
    store.seed(media([photo("old")], 1_000));
    expect(store.getSnapshot().media?.photos.map((entry) => entry.id)).toEqual(["new"]);
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
});

describe("finished uploads", () => {
  it("adds the rows the queue just finished, with their URLs", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")], 1_000, []));
    vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [photo("b", { thumbUrl: "https://new/thumb/b" })] });
    vi.mocked(loadFiles).mockResolvedValue({ ok: true, files: [file] });
    await store.takeUploaded([item("b", "photo"), item("f1", "file")]);
    expect(vi.mocked(loadPhotos).mock.calls[0][1]).toEqual(["b"]);
    expect(vi.mocked(loadFiles).mock.calls[0][1]).toEqual(["f1"]);
    const current = store.getSnapshot().media;
    expect(current?.photos.map((entry) => [entry.id, entry.thumbUrl])).toEqual([
      ["a", "https://old/thumb/a"],
      ["b", "https://new/thumb/b"],
    ]);
    expect(current?.files).toEqual([file]);
  });

  it("waits for a load in flight, which may have read the rows just before they went in", async () => {
    let finish!: (value: Awaited<ReturnType<typeof loadInspectionMedia>>) => void;
    vi.mocked(loadInspectionMedia).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    vi.mocked(loadPhotos).mockResolvedValue({ ok: true, photos: [photo("b")] });
    const store = new InspectionMediaStore(INSPECTION);
    const loading = store.load();
    const taking = store.takeUploaded([item("b", "photo")]);
    finish({ kind: "ok", media: media([photo("a")]) });
    await Promise.all([loading, taking]);
    expect(store.getSnapshot().media?.photos.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("loads everything when uploads finish before the first load worked (a page opened offline)", async () => {
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "error", message: "offline" });
    const store = new InspectionMediaStore(INSPECTION);
    await store.load();
    vi.mocked(loadInspectionMedia).mockResolvedValueOnce({ kind: "ok", media: media([photo("b")]) });
    await store.takeUploaded([item("b", "photo")]);
    expect(loadPhotos).not.toHaveBeenCalled();
    expect(loadInspectionMedia).toHaveBeenCalledTimes(2);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", media: { photos: [{ id: "b" }] } });
  });

  it("routes each finished item to the store of its inspection", async () => {
    const store = mediaStore(INSPECTION);
    const other = mediaStore(OTHER_INSPECTION);
    expect(mediaStore(INSPECTION)).toBe(store);
    const take = vi.spyOn(store, "takeUploaded").mockResolvedValue();
    const takeOther = vi.spyOn(other, "takeUploaded").mockResolvedValue();
    const [[listener]] = vi.mocked(photoQueueStore.onSettled).mock.calls;
    listener([item("a", "photo"), item("x", "photo", OTHER_INSPECTION), item("f", "file")]);
    expect(take).toHaveBeenCalledWith([item("a", "photo"), item("f", "file")]);
    expect(takeOther).toHaveBeenCalledWith([item("x", "photo", OTHER_INSPECTION)]);
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
    expect(store.getSnapshot().media?.photos.map((entry) => entry.id)).toEqual(["b"]);
    expect(store.getSnapshot().media?.files).toEqual([]);
  });

  it("tells nobody when a removed photo was not there", () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a")]));
    const listener = vi.fn();
    store.subscribe(listener);
    store.removePhoto("missing");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("resign", () => {
  it("signs every URL again, keeping the old one where signing failed", async () => {
    const store = new InspectionMediaStore(INSPECTION);
    store.seed(media([photo("a"), photo("b")], 1_000, [file]));
    vi.mocked(signPaths).mockImplementation(async (_client, bucket, paths) => ({
      // b's full photo cannot be signed (its object went missing); its thumbnail can.
      urls: new Map(
        paths.filter((path) => path !== `${INSPECTION}/b.jpg`).map((path) => [path, `https://new/${bucket}/${path}`] as const),
      ),
      complete: false,
    }));
    await store.resign();
    const current = store.getSnapshot().media;
    expect(current?.photos.map((entry) => [entry.thumbUrl, entry.fullUrl])).toEqual([
      [`https://new/inspection-photos/${INSPECTION}/thumbs/a.jpg`, `https://new/inspection-photos/${INSPECTION}/a.jpg`],
      [`https://new/inspection-photos/${INSPECTION}/thumbs/b.jpg`, "https://old/full/b"],
    ]);
    expect(current?.files[0].url).toBe(`https://new/inspection-files/${INSPECTION}/f1.pdf`);
    expect(current?.signedAt).toBeGreaterThan(1_000);
  });
});
