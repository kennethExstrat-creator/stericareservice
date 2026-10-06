import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manualConnectivity } from "@/lib/offline/connectivity";
import { FAILURE_MESSAGES } from "@/lib/offline/failures";
import { createMemoryStore, type KeyValueStore } from "@/lib/offline/kv";
import { FakeRepository, FakeStorage, fakeLock } from "./__fixtures__/fake-media";
import { buildJpeg } from "./__fixtures__/jpeg";
import type { PreparedFile } from "./files";
import type { ProcessedPhoto } from "./process";
import { createUploadQueue, type UploadQueue } from "./upload-queue";

const USER = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b";
const INSPECTION = "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10";
const OTHER_INSPECTION = "0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f";
const TAKEN_AT = "2024-07-12T02:15:30.123Z";

/** Predictable lowercase UUIDs: 00000000-0000-4000-8000-00000000000n. */
function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function photo(overrides: Partial<ProcessedPhoto> = {}): ProcessedPhoto {
  return {
    blob: new Blob([buildJpeg({ width: 2048, height: 1536 })], { type: "image/jpeg" }),
    thumbBlob: new Blob([buildJpeg({ width: 400, height: 300 })], { type: "image/jpeg" }),
    width: 2048,
    height: 1536,
    takenAt: TAKEN_AT,
    flagged: false,
    mimeType: "image/jpeg",
    ...overrides,
  };
}

const visualTag = { moduleKey: "visual", target: { size: "M", hand: "R" as const, defect: "thin_spot" } };

/** Real I/O (Blob reads) and fake timers both get to run. */
async function settle() {
  for (let round = 0; round < 30; round++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

function setup({
  items = createMemoryStore<unknown>(),
  blobs = createMemoryStore<unknown>(),
  storage = new FakeStorage(),
  repository = new FakeRepository(),
  net = manualConnectivity(true),
  elsewhere = new Set<string>(),
  userId = USER,
}: {
  items?: KeyValueStore<unknown>;
  blobs?: KeyValueStore<unknown>;
  storage?: FakeStorage;
  repository?: FakeRepository;
  net?: ReturnType<typeof manualConnectivity>;
  elsewhere?: Set<string>;
  userId?: string;
} = {}) {
  const queue = createUploadQueue({
    userId,
    items,
    blobs,
    storage,
    repository,
    connectivity: net,
    lock: fakeLock(elsewhere),
    random: () => 0,
    newId: ids(),
  });
  return { queue, items, blobs, storage, repository, net, elsewhere };
}

let queues: UploadQueue[] = [];
function track<T extends { queue: UploadQueue }>(made: T): T {
  queues.push(made.queue);
  return made;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
  queues = [];
});

afterEach(() => {
  for (const queue of queues) queue.stop();
  vi.useRealTimers();
});

describe("upload queue: the happy path", () => {
  it("returns at once, then uploads the photo, its thumbnail and the row, in that order", async () => {
    const { queue, storage, repository, items, blobs } = track(setup());
    await queue.start();
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag, caption: "Thin spot near the cuff" });

    expect(photoId).toBe(id(1));
    expect(queue.pendingCount(INSPECTION)).toBe(1);
    expect(queue.isEmpty(INSPECTION)).toBe(false);
    expect(queue.isEmpty(OTHER_INSPECTION)).toBe(true);
    expect(await items.keys()).toEqual([photoId]);
    expect(await blobs.keys()).toEqual([`${photoId}/object`, `${photoId}/thumb`]);

    storage.release();
    await settle();
    expect([...storage.calls, ...repository.calls]).toEqual([
      `upload inspection-photos/${INSPECTION}/${photoId}.jpg`,
      `upload inspection-photos/${INSPECTION}/thumbs/${photoId}.jpg`,
      `insertPhoto ${photoId}`,
    ]);
    expect(repository.photos.get(photoId)).toEqual({
      id: photoId,
      inspection_id: INSPECTION,
      module_key: "visual",
      target: "size:M/hand:R/defect:thin_spot",
      storage_path: `${INSPECTION}/${photoId}.jpg`,
      thumb_path: `${INSPECTION}/thumbs/${photoId}.jpg`,
      caption: "Thin spot near the cuff",
      taken_at: TAKEN_AT,
      width: 2048,
      height: 1536,
      flagged: false,
    });
    expect(storage.objects.get(`inspection-photos/${INSPECTION}/${photoId}.jpg`)).toMatchObject({ contentType: "image/jpeg" });
    expect(queue.isEmpty(INSPECTION)).toBe(true);
    expect(queue.getSnapshot()).toMatchObject({ items: [], pending: 0, failed: 0, error: null });
    expect(await items.keys()).toEqual([]);
    expect(await blobs.keys()).toEqual([]);
  });

  it("uploads lab reports to inspection-files with their row", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    const pdf: PreparedFile = {
      blob: new Blob(["%PDF-1.7 lab report"], { type: "application/pdf" }),
      name: "Lab report.pdf",
      mimeType: "application/pdf",
      extension: "pdf",
    };
    const fileId = await queue.enqueueFile({ inspectionId: INSPECTION, file: pdf, moduleKey: "tensile", kind: "lab_report" });
    await settle();
    expect(storage.calls).toEqual([`upload inspection-files/${INSPECTION}/${fileId}.pdf`]);
    expect(storage.objects.get(`inspection-files/${INSPECTION}/${fileId}.pdf`)).toMatchObject({ contentType: "application/pdf" });
    expect(repository.files.get(fileId)).toEqual({
      id: fileId,
      inspection_id: INSPECTION,
      module_key: "tensile",
      kind: "lab_report",
      storage_path: `${INSPECTION}/${fileId}.pdf`,
      name: "Lab report.pdf",
    });
  });

  it("uploads a flagged original with its own extension and no thumbnail", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    const heic = photo({
      blob: new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])], { type: "image/heic" }),
      thumbBlob: null,
      width: null,
      height: null,
      flagged: true,
      mimeType: "image/heic",
    });
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: heic, tag: { moduleKey: "visual", target: {} } });
    expect(await queue.preview(photoId)).toBeNull();
    storage.release();
    await settle();
    expect(storage.calls).toEqual([`upload inspection-photos/${INSPECTION}/${photoId}.heic`]);
    expect(repository.photos.get(photoId)).toMatchObject({ flagged: true, thumb_path: null, target: null, width: null });
  });

  it("uploads one item at a time, in the order they were queued", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.hold();
    const first = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    const second = await queue.enqueuePhoto({ inspectionId: OTHER_INSPECTION, photo: photo(), tag: visualTag });
    const third = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo({ thumbBlob: null }), tag: visualTag });
    await settle();
    expect(storage.calls).toHaveLength(1);
    expect(queue.getSnapshot().items.map((item) => [item.id, item.state])).toEqual([
      [first, "uploading"],
      [second, "waiting"],
      [third, "waiting"],
    ]);
    expect(queue.pendingCount()).toBe(3);
    expect(queue.pendingCount(INSPECTION)).toBe(2);

    storage.release();
    await settle();
    expect(repository.calls).toEqual([`insertPhoto ${first}`, `insertPhoto ${second}`, `insertPhoto ${third}`]);
  });

  it("reports progress for the badge and the photo tile", async () => {
    const { queue, storage } = track(setup());
    await queue.start();
    const seen: number[] = [];
    queue.subscribe(() => {
      const item = queue.getSnapshot().items[0];
      if (item && seen.at(-1) !== item.progress) seen.push(item.progress);
    });
    await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(seen[0]).toBe(0);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((value, index) => index === 0 || value >= seen[index - 1])).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(storage.objects.size).toBe(2);
  });

  it("shows queued photos from their local thumbnail", async () => {
    const { queue, storage } = track(setup());
    await queue.start();
    storage.hold();
    const processed = photo();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: processed, tag: visualTag });
    const preview = await queue.preview(photoId);
    expect(preview?.type).toBe("image/jpeg");
    expect(preview?.size).toBe(processed.thumbBlob?.size);
    expect(await queue.preview("not-queued")).toBeNull();
  });
});

describe("upload queue: failures and retries", () => {
  it("backs off while offline and retries at once when the connection returns", async () => {
    const { queue, storage, repository, net } = track(setup());
    await queue.start();
    storage.reachable = false;
    await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(storage.calls).toHaveLength(1);
    expect(queue.getSnapshot()).toMatchObject({
      pending: 1,
      retryAt: Date.now() + 2000,
      error: { reason: "network" },
      items: [{ state: "waiting", error: { reason: "network" } }],
    });

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(storage.calls).toHaveLength(2);
    expect(queue.getSnapshot().retryAt).toBe(Date.now() + 4000);

    storage.reachable = true;
    net.set(false);
    net.set(true);
    await settle();
    expect(repository.photos.size).toBe(1);
    expect(queue.getSnapshot()).toMatchObject({ pending: 0, retryAt: null, error: null });
  });

  it("never duplicates an object or a row when answers are lost", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.loseNextAnswer = true;
    repository.loseNextAnswer = true;
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    await vi.advanceTimersByTimeAsync(4000);
    await settle();

    expect(storage.calls).toEqual([
      `upload inspection-photos/${INSPECTION}/${photoId}.jpg`,
      `upload inspection-photos/${INSPECTION}/${photoId}.jpg`,
      `upload inspection-photos/${INSPECTION}/thumbs/${photoId}.jpg`,
    ]);
    expect(repository.calls).toEqual([`insertPhoto ${photoId}`, `insertPhoto ${photoId}`]);
    expect(storage.objects.size).toBe(2);
    expect(repository.photos.size).toBe(1);
    expect(queue.isEmpty(INSPECTION)).toBe(true);
  });

  it("stops an item on a failure that needs a person, moves on, and retries it on request", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.scripted.push({ ok: false, reason: "forbidden", message: "new row violates row-level security policy" });
    const blocked = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    const next = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();

    expect(repository.photos.has(next)).toBe(true);
    expect(queue.getSnapshot()).toMatchObject({
      pending: 1,
      failed: 1,
      retryAt: null,
      items: [{ id: blocked, state: "failed", error: { reason: "forbidden" } }],
    });
    expect(queue.isEmpty(INSPECTION)).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(storage.calls.filter((call) => call.includes(blocked))).toHaveLength(1);

    queue.retryNow(blocked);
    await settle();
    expect(repository.photos.has(blocked)).toBe(true);
    expect(queue.isEmpty(INSPECTION)).toBe(true);
  });

  it("waits out an expired session and says so", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.scripted.push({ ok: false, reason: "unauthorized", message: "jwt expired" });
    await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(queue.getSnapshot()).toMatchObject({ error: { reason: "unauthorized" }, retryAt: Date.now() + 2000, failed: 0 });
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(repository.photos.size).toBe(1);
  });

  it("fails an item whose bytes are gone from this device instead of retrying forever", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const before = track(setup({ items, blobs }));
    before.storage.reachable = false;
    await before.queue.start();
    const photoId = await before.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    before.queue.stop();

    await blobs.clear();
    const after = track(setup({ items, blobs }));
    await after.queue.start();
    await settle();
    expect(after.queue.getSnapshot()).toMatchObject({
      failed: 1,
      items: [{ id: photoId, state: "failed", error: { reason: "not_found" } }],
    });
  });
});

describe("upload queue: reloads and other tabs", () => {
  it("keeps queued items through a reload and uploads them after it", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const before = track(setup({ items, blobs }));
    before.storage.reachable = false;
    await before.queue.start();
    const photoId = await before.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    before.queue.stop();

    const after = track(setup({ items, blobs }));
    // Until the kept items are read, nobody knows: submit stays blocked.
    expect(after.queue.isEmpty(INSPECTION)).toBe(false);
    expect(after.queue.getSnapshot().load).toBe("loading");
    after.storage.hold();
    await after.queue.start();
    expect(after.queue.getSnapshot().load).toBe("ready");
    expect(after.queue.pendingCount(INSPECTION)).toBe(1);
    expect(after.queue.isEmpty(INSPECTION)).toBe(false);
    after.storage.release();
    await settle();
    expect(after.repository.photos.get(photoId)).toMatchObject({ target: "size:M/hand:R/defect:thin_spot", taken_at: TAKEN_AT });
    expect(after.queue.isEmpty(INSPECTION)).toBe(true);
  });

  it("keeps submit blocked while the kept items cannot be read, and reads them again", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const before = track(setup({ items, blobs }));
    before.storage.reachable = false;
    await before.queue.start();
    const photoId = await before.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    before.queue.stop();

    let failures = 1;
    const flaky: KeyValueStore<unknown> = {
      ...items,
      getAll: () =>
        failures-- > 0
          ? Promise.reject(new DOMException("Connection to Indexed Database server lost.", "UnknownError"))
          : items.getAll(),
    };
    const after = track(setup({ items: flaky, blobs }));
    await after.queue.start();
    expect(after.queue.getSnapshot()).toMatchObject({ load: "failed", pending: 0 });
    expect(after.queue.isEmpty(INSPECTION)).toBe(false);
    expect(await after.queue.isEmptyNow(INSPECTION)).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(after.queue.getSnapshot().load).toBe("ready");
    expect(after.repository.photos.has(photoId)).toBe(true);
    expect(after.queue.isEmpty(INSPECTION)).toBe(true);
    expect(await after.queue.isEmptyNow(INSPECTION)).toBe(true);
  });

  it("reads the kept items again at once when the connection returns", async () => {
    let failures = 1;
    const memory = createMemoryStore<unknown>();
    const flaky: KeyValueStore<unknown> = {
      ...memory,
      getAll: () => (failures-- > 0 ? Promise.reject(new DOMException("Lost.", "UnknownError")) : memory.getAll()),
    };
    const { queue, net } = track(setup({ items: flaky }));
    await queue.start();
    expect(queue.getSnapshot().load).toBe("failed");
    net.set(false);
    net.set(true);
    await settle();
    expect(queue.getSnapshot().load).toBe("ready");
    expect(queue.isEmpty(INSPECTION)).toBe(true);
  });

  it("counts items another tab queued in the submit check", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const mine = track(setup({ items, blobs }));
    await mine.queue.start();

    const otherTab = track(setup({ items, blobs }));
    otherTab.storage.reachable = false;
    await otherTab.queue.start();
    await otherTab.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();

    expect(mine.queue.isEmpty(INSPECTION)).toBe(true);
    expect(await mine.queue.isEmptyNow(INSPECTION)).toBe(false);
    expect(await mine.queue.isEmptyNow(OTHER_INSPECTION)).toBe(true);
    expect(await mine.queue.isEmptyNow()).toBe(false);

    const unreadable: KeyValueStore<unknown> = { ...items, getAll: () => Promise.reject(new Error("Lost.")) };
    const blind = track(setup({ items: unreadable, blobs }));
    expect(await blind.queue.isEmptyNow(OTHER_INSPECTION)).toBe(false);
  });

  it("counts a photo from the moment it is handed over, before it is stored", async () => {
    const memory = createMemoryStore<unknown>();
    let open: (() => void) | null = null;
    const slow: KeyValueStore<unknown> = {
      ...memory,
      put: async (key, value) => {
        await new Promise<void>((resolve) => (open = resolve));
        return memory.put(key, value);
      },
    };
    const { queue } = track(setup({ blobs: slow }));
    await queue.start();
    const enqueued = queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo({ thumbBlob: null }), tag: visualTag });
    await settle();
    expect(queue.pendingCount(INSPECTION)).toBe(1);
    expect(queue.getSnapshot()).toMatchObject({ pending: 1, items: [] });
    expect(queue.isEmpty(INSPECTION)).toBe(false);
    expect(await queue.isEmptyNow(INSPECTION)).toBe(false);
    (open as unknown as () => void)();
    await enqueued;
    expect(queue.getSnapshot().items).toHaveLength(1);
  });

  it("resumes after a reload at the step it reached, without uploading again", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const before = track(setup({ items, blobs }));
    before.repository.reachable = false;
    await before.queue.start();
    const photoId = await before.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(before.storage.objects.size).toBe(2);
    before.queue.stop();

    const after = track(setup({ items, blobs }));
    await after.queue.start();
    await settle();
    expect(after.storage.calls).toEqual([]);
    expect(after.repository.calls).toEqual([`insertPhoto ${photoId}`]);
  });

  it("leaves another user's items alone", async () => {
    const items = createMemoryStore<unknown>();
    const blobs = createMemoryStore<unknown>();
    const theirs = track(setup({ items, blobs, userId: "someone-else" }));
    theirs.storage.reachable = false;
    await theirs.queue.start();
    await theirs.queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    theirs.queue.stop();

    const mine = track(setup({ items, blobs }));
    await mine.queue.start();
    await settle();
    expect(mine.queue.pendingCount()).toBe(0);
    expect(mine.storage.calls).toEqual([]);
    expect(await items.keys()).toHaveLength(1);
  });

  it("skips an item another tab is uploading, and looks again later", async () => {
    const elsewhere = new Set<string>([`stericare-upload:${id(1)}`]);
    const { queue, repository } = track(setup({ elsewhere }));
    await queue.start();
    const busy = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    const free = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(repository.calls).toEqual([`insertPhoto ${free}`]);
    expect(queue.getSnapshot()).toMatchObject({ retryAt: null, items: [{ id: busy, state: "waiting" }] });

    elsewhere.clear();
    await vi.advanceTimersByTimeAsync(59_999);
    await settle();
    expect(repository.photos.has(busy)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(repository.photos.has(busy)).toBe(true);
  });

  it("drops an item another tab finished meanwhile", async () => {
    const { queue, items, storage } = track(setup());
    storage.reachable = false;
    await queue.start();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await items.delete(photoId);
    storage.reachable = true;
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(queue.pendingCount()).toBe(0);
    expect(storage.calls).toHaveLength(1);
  });

  it("collects bytes left by an enqueue that never finished, once they are an hour old", async () => {
    const blobs = createMemoryStore<unknown>();
    const stored = { type: "image/jpeg", bytes: new ArrayBuffer(4) };
    await blobs.put(`${id(90)}/object`, { ...stored, storedAt: Date.now() - 2 * 60 * 60 * 1000 });
    await blobs.put(`${id(91)}/object`, { ...stored, storedAt: Date.now() - 60 * 1000 });
    await blobs.put(`${id(92)}/object`, { junk: true });
    const { queue } = track(setup({ blobs }));
    await queue.start();
    expect(await blobs.keys()).toEqual([`${id(91)}/object`]);
  });
});

describe("upload queue: retag and remove", () => {
  it("puts a retag made before the upload into the row", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    expect(
      await queue.retag(photoId, { tag: { moduleKey: "dispensing_packing", target: { size: "L", box: 12 } }, caption: "Box 12" }),
    ).toBe(true);
    expect(queue.getSnapshot().items[0]).toMatchObject({ moduleKey: "dispensing_packing", target: "size:L/box:12", caption: "Box 12" });
    storage.release();
    await settle();
    expect(repository.photos.get(photoId)).toMatchObject({ module_key: "dispensing_packing", target: "size:L/box:12", caption: "Box 12" });
    expect(repository.calls).toEqual([`insertPhoto ${photoId}`]);
  });

  it("follows a retag made while the row is being written with an update", async () => {
    const { queue, repository } = track(setup());
    await queue.start();
    repository.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(repository.calls).toEqual([`insertPhoto ${photoId}`]);
    await queue.retag(photoId, { tag: { moduleKey: "visual", target: { size: "M", defect: "stain" } } });
    repository.release();
    await settle();
    expect(repository.calls).toEqual([`insertPhoto ${photoId}`, `updatePhoto ${photoId} size:M/defect:stain`]);
    expect(repository.photos.get(photoId)?.target).toBe("size:M/defect:stain");
    expect(await queue.retag(photoId, { caption: "too late" })).toBe(false);
  });

  it("removes an item before upload, deleting what already went up", async () => {
    const { queue, storage, repository, items, blobs } = track(setup());
    await queue.start();
    repository.reachable = false;
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(storage.objects.size).toBe(2);

    expect(await queue.remove(photoId)).toBe(true);
    expect(storage.calls.at(-1)).toBe(
      `remove inspection-photos ${INSPECTION}/${photoId}.jpg ${INSPECTION}/thumbs/${photoId}.jpg`,
    );
    expect(storage.objects.size).toBe(0);
    expect(queue.isEmpty(INSPECTION)).toBe(true);
    expect(await items.keys()).toEqual([]);
    expect(await blobs.keys()).toEqual([]);
    expect(await queue.remove(photoId)).toBe(false);
  });

  it("cancels an upload in flight when its item is removed", async () => {
    const { queue, storage, repository } = track(setup());
    await queue.start();
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    expect(await queue.remove(photoId)).toBe(true);
    expect(storage.signals[0].aborted).toBe(true);
    storage.release();
    await settle();
    expect(repository.calls).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });

  it("brings a retag made while the row was written to the row on a later retry", async () => {
    const { queue, repository } = track(setup());
    await queue.start();
    repository.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await queue.retag(photoId, { caption: "Retagged while writing" });
    repository.failNextUpdate = { ok: false, reason: "network", message: "No connection." };
    repository.release();
    await settle();
    // The row is written; only the retag is waiting for its retry, and submit waits for it.
    expect(repository.photos.has(photoId)).toBe(true);
    expect(queue.isEmpty(INSPECTION)).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(queue.pendingCount()).toBe(0);
    expect(repository.photos.get(photoId)?.caption).toBe("Retagged while writing");
  });

  it("finishes a photo whose retag the server refuses for good, and reports the retag instead", async () => {
    const { queue, repository } = track(setup());
    await queue.start();
    repository.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await queue.retag(photoId, { tag: { moduleKey: "visual", target: { size: "M", defect: "stain" } }, caption: "Stain" });
    repository.failNextUpdate = { ok: false, reason: "forbidden", message: "The inspection has been submitted." };
    repository.release();
    await settle();

    expect(queue.isEmpty(INSPECTION)).toBe(true);
    expect(repository.photos.get(photoId)).toMatchObject({ target: "size:M/hand:R/defect:thin_spot", caption: null });
    expect(queue.getSnapshot().retagFailures).toEqual([
      {
        id: photoId,
        inspectionId: INSPECTION,
        moduleKey: "visual",
        target: "size:M/defect:stain",
        caption: "Stain",
        error: { reason: "forbidden", message: "The inspection has been submitted." },
      },
    ]);
    queue.dismissRetagFailure(photoId);
    expect(queue.getSnapshot().retagFailures).toEqual([]);
  });

  it("never gets stuck on a retag whose row was deleted meanwhile", async () => {
    const { queue, repository } = track(setup());
    await queue.start();
    repository.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await queue.retag(photoId, { caption: "glove 3, pinhole" });
    repository.failNextUpdate = { ok: false, reason: "network", message: "No connection." };
    repository.release();
    await settle();

    // The row is deleted elsewhere (the gallery, another device); updates now find no row.
    repository.photos.delete(photoId);
    repository.failNextUpdate = { ok: false, reason: "forbidden", message: FAILURE_MESSAGES.forbidden };
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(queue.getSnapshot()).toMatchObject({ pending: 0, failed: 0, retagFailures: [{ id: photoId }] });
    expect(queue.isEmpty(INSPECTION)).toBe(true);
  });

  it("drops an item whose row is written when it is removed: the caller deletes that row", async () => {
    const { queue, repository, items, blobs } = track(setup());
    await queue.start();
    repository.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    await queue.retag(photoId, { caption: "Retagged while writing" });
    repository.failNextUpdate = { ok: false, reason: "network", message: "No connection." };
    repository.release();
    await settle();
    expect(queue.pendingCount()).toBe(1);

    expect(await queue.remove(photoId)).toBe(false);
    expect(queue.isEmpty(INSPECTION)).toBe(true);
    expect(await items.keys()).toEqual([]);
    expect(await blobs.keys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(repository.calls.filter((call) => call.startsWith("updatePhoto"))).toHaveLength(1);
    expect(queue.getSnapshot().retagFailures).toEqual([]);
  });
});

describe("upload queue: keeping items on this device", () => {
  it("says items are not kept through a reload on the in-memory fallback", async () => {
    const queue = createUploadQueue({
      userId: USER,
      items: createMemoryStore<unknown>(),
      blobs: createMemoryStore<unknown>(),
      persistent: false,
      storage: new FakeStorage(),
      repository: new FakeRepository(),
      connectivity: manualConnectivity(true),
      lock: fakeLock(new Set()),
    });
    queues.push(queue);
    await queue.start();
    expect(queue.getSnapshot().localCopy).toBe(false);
  });

  it("counts an item kept only in memory in the submit check", async () => {
    const memory = createMemoryStore<unknown>();
    const full: KeyValueStore<unknown> = {
      ...memory,
      put: async () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    const { queue, storage } = track(setup({ blobs: full }));
    await queue.start();
    storage.hold();
    await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    expect(await queue.isEmptyNow(INSPECTION)).toBe(false);
    storage.release();
    await settle();
    expect(await queue.isEmptyNow(INSPECTION)).toBe(true);
  });

  it("still uploads from memory when the item cannot be stored locally, and says so", async () => {
    const memory = createMemoryStore<unknown>();
    const full: KeyValueStore<unknown> = {
      ...memory,
      put: async () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    const { queue, repository, storage } = track(setup({ blobs: full }));
    await queue.start();
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    expect(queue.getSnapshot().localCopy).toBe(false);
    expect(await queue.preview(photoId)).not.toBeNull();
    storage.release();
    await settle();
    expect(repository.photos.has(photoId)).toBe(true);
  });

  it("refuses ids that would break the storage path and types the buckets refuse", async () => {
    const { queue } = track(setup());
    await expect(queue.enqueuePhoto({ inspectionId: "INS-2026-0001", photo: photo(), tag: visualTag })).rejects.toThrow(/UUID/);
    await expect(
      queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo({ mimeType: "image/gif" }), tag: visualTag }),
    ).rejects.toThrow(/cannot be stored/);
  });

  it("stop() aborts the transfer and keeps the item for the next start", async () => {
    const { queue, storage, items } = track(setup());
    await queue.start();
    storage.hold();
    const photoId = await queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag });
    await settle();
    queue.stop();
    expect(storage.signals[0].aborted).toBe(true);
    await settle();
    expect(await items.keys()).toEqual([photoId]);
    await expect(queue.enqueuePhoto({ inspectionId: INSPECTION, photo: photo(), tag: visualTag })).rejects.toThrow(/stopped/);
  });
});
