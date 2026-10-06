import { describe, expect, it } from "vitest";
import type { InspectionMedia } from "@/lib/inspections/photos/queries";
import { EMPTY_TAG_OPTIONS, type MediaFile, type MediaPhoto } from "@/lib/inspections/photos/view";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { describeItems, slotFiles, slotPhotos, uploadStatusFor } from "./photo-model";
import {
  bumpPreparing,
  EMPTY_QUEUE_SNAPSHOT,
  INITIAL_QUEUE_STATE,
  moduleSlotKey,
  QUEUE_PROBLEMS,
  type PhotoQueueState,
} from "./queue-state";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const OTHER_INSPECTION = "9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a";

function uploaded(id: string, patch: Partial<MediaPhoto> = {}): MediaPhoto {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey: "dimensions",
    target: "size:M",
    caption: null,
    takenAt: "2026-10-06T09:14:03+08:00",
    width: 2048,
    height: 1536,
    flagged: false,
    includeInReport: false,
    createdBy: "inspector",
    createdAt: "2026-10-06T01:14:05.123456+00:00",
    storagePath: `${INSPECTION}/${id}.jpg`,
    thumbPath: `${INSPECTION}/thumbs/${id}.jpg`,
    thumbUrl: `https://signed/thumb/${id}`,
    fullUrl: `https://signed/full/${id}`,
    ...patch,
  };
}

function queued(id: string, patch: Partial<UploadItem> = {}): UploadItem {
  return {
    id,
    kind: "photo",
    inspectionId: INSPECTION,
    moduleKey: "dimensions",
    target: "size:M",
    caption: null,
    name: null,
    flagged: false,
    takenAt: "2026-10-06T09:20:00+08:00",
    state: "waiting",
    progress: 0,
    error: null,
    createdAt: 1,
    ...patch,
  };
}

function media(photos: MediaPhoto[], files: MediaFile[] = []): InspectionMedia {
  return {
    inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: "inspector" },
    access: { canEdit: true, isAdmin: false },
    photos,
    files,
    options: EMPTY_TAG_OPTIONS,
    signedAt: 0,
    problems: [],
  };
}

function state(patch: Partial<PhotoQueueState> & { items?: UploadItem[]; load?: "loading" | "ready" | "failed"; online?: boolean }): PhotoQueueState {
  const { items = [], load = "ready", online = true, ...rest } = patch;
  return {
    ...INITIAL_QUEUE_STATE,
    phase: "ready",
    userId: "inspector",
    queue: { ...EMPTY_QUEUE_SNAPSHOT, load, online, items, pending: items.length },
    ...rest,
  };
}

describe("slotPhotos", () => {
  it("shows uploaded photos, then the ones still on this device, for the module asked", () => {
    const photos = slotPhotos({
      media: media([uploaded("a"), uploaded("b", { moduleKey: "visual" })]),
      queue: state({
        items: [queued("c"), queued("d", { moduleKey: "visual" }), queued("e", { inspectionId: OTHER_INSPECTION })],
        previews: { c: "blob:c" },
      }),
      inspectionId: INSPECTION,
      moduleKey: "dimensions",
    });
    expect(photos.map(({ id, queued: isQueued, state: upload, thumbUrl }) => [id, isQueued, upload, thumbUrl])).toEqual([
      ["a", false, "uploaded", "https://signed/thumb/a"],
      ["c", true, "waiting", "blob:c"],
    ]);
  });

  it("shows a photo once, as queued with its newer tags, while a retag is on its way to its row", () => {
    const photos = slotPhotos({
      media: media([uploaded("a", { moduleKey: "dimensions", includeInReport: true })]),
      queue: state({ items: [queued("a", { moduleKey: "visual", target: "size:M/defect:stain", state: "uploading" })] }),
      inspectionId: INSPECTION,
      moduleKey: undefined,
    });
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      id: "a",
      queued: true,
      moduleKey: "visual",
      target: "size:M/defect:stain",
      state: "uploading",
      includeInReport: true,
      // No local preview on this page: the uploaded copy's signed thumbnail.
      thumbUrl: "https://signed/thumb/a",
      fullUrl: "https://signed/full/a",
    });
    // Moved away from dimensions by the retag: not shown there twice.
    expect(slotPhotos({ media: media([uploaded("a")]), queue: state({ items: [queued("a", { moduleKey: "visual" })] }), inspectionId: INSPECTION, moduleKey: "dimensions" })).toEqual([]);
  });

  it("keeps the local preview after the upload, so the tile does not flash", () => {
    const [photo] = slotPhotos({
      media: media([uploaded("a")]),
      queue: state({ previews: { a: "blob:a" } }),
      inspectionId: INSPECTION,
      moduleKey: "dimensions",
    });
    expect(photo.thumbUrl).toBe("blob:a");
  });

  it("marks a queued photo whose preview is still being read, and one that has none", () => {
    const photos = slotPhotos({
      media: null,
      queue: state({ items: [queued("a"), queued("b", { flagged: true })], previews: { b: null } }),
      inspectionId: INSPECTION,
      moduleKey: "dimensions",
    });
    expect(photos.map((photo) => photo.thumbUrl)).toEqual([undefined, null]);
  });

  it("filters untagged photos with null and takes every photo with undefined", () => {
    const input = {
      media: media([uploaded("a", { moduleKey: null }), uploaded("b")]),
      queue: state({ items: [queued("c", { moduleKey: null })] }),
      inspectionId: INSPECTION,
    };
    expect(slotPhotos({ ...input, moduleKey: null }).map((photo) => photo.id)).toEqual(["a", "c"]);
    expect(slotPhotos({ ...input, moduleKey: undefined }).map((photo) => photo.id)).toEqual(["a", "b", "c"]);
  });

  it("carries a failed upload's reason", () => {
    const [photo] = slotPhotos({
      media: null,
      queue: state({ items: [queued("a", { state: "failed", error: { reason: "forbidden", message: "Not allowed now." } })] }),
      inspectionId: INSPECTION,
      moduleKey: "dimensions",
    });
    expect(photo).toMatchObject({ state: "failed", error: "Not allowed now." });
  });
});

describe("slotFiles", () => {
  const file: MediaFile = {
    id: "f1",
    inspectionId: INSPECTION,
    moduleKey: "tensile",
    kind: "lab_report",
    name: "Tensile.pdf",
    createdBy: "inspector",
    createdAt: "2026-10-06T01:14:05.123456+00:00",
    storagePath: `${INSPECTION}/f1.pdf`,
    url: "https://signed/f1",
  };

  it("lists uploaded files, then queued ones, of one module", () => {
    const files = slotFiles({
      files: [file, { ...file, id: "f2", moduleKey: "documents" }],
      queue: state({
        items: [
          queued("f3", { kind: "file", moduleKey: "tensile", name: "Second.pdf", state: "uploading", progress: 0.5 }),
          queued("p1", { moduleKey: "tensile" }),
        ],
      }),
      inspectionId: INSPECTION,
      moduleKey: "tensile",
    });
    expect(files.map(({ id, queued: isQueued, name, state: upload, url }) => [id, isQueued, name, upload, url])).toEqual([
      ["f1", false, "Tensile.pdf", "uploaded", "https://signed/f1"],
      ["f3", true, "Second.pdf", "uploading", null],
    ]);
  });
});

describe("uploadStatusFor: the badge and the submit check", () => {
  it("lets submit go when nothing waits", () => {
    expect(uploadStatusFor(state({}), INSPECTION)).toEqual({
      ready: true,
      preparing: 0,
      photos: 0,
      files: 0,
      failed: 0,
      pending: 0,
      online: true,
      blocking: false,
      message: null,
    });
  });

  it("waits while the queue has not read what this device kept: unknown is never 0", () => {
    expect(uploadStatusFor(state({ phase: "idle" }), INSPECTION)).toMatchObject({
      ready: false,
      blocking: true,
      message: "Checking for photos waiting on this device.",
    });
    expect(uploadStatusFor(state({ load: "loading" }), INSPECTION)).toMatchObject({ ready: false, blocking: true });
    expect(uploadStatusFor(state({ load: "failed" }), INSPECTION)).toMatchObject({
      blocking: true,
      message: "This device could not check for photos waiting to upload. Retrying.",
    });
  });

  it("waits while photos are being prepared, before the queue knows them", () => {
    const preparing = bumpPreparing({}, INSPECTION, "photos", 2);
    expect(uploadStatusFor(state({ preparing }), INSPECTION)).toMatchObject({
      preparing: 2,
      pending: 2,
      blocking: true,
      message: "Preparing 2 photos for upload.",
    });
  });

  it("waits for this inspection's uploads only, and says what", () => {
    const items = [queued("a"), queued("b", { kind: "file", name: "Lab.pdf" }), queued("c", { inspectionId: OTHER_INSPECTION })];
    expect(uploadStatusFor(state({ items }), INSPECTION)).toMatchObject({
      photos: 1,
      files: 1,
      pending: 2,
      blocking: true,
      message: "Waiting for 1 photo and 1 file to upload.",
    });
    expect(uploadStatusFor(state({ items }), OTHER_INSPECTION)).toMatchObject({ pending: 1, message: "Waiting for 1 photo to upload." });
  });

  it("says offline uploads wait on the device", () => {
    expect(uploadStatusFor(state({ items: [queued("a"), queued("b")], online: false }), INSPECTION).message).toBe(
      "Offline: 2 photos wait on this device and upload when the connection is back.",
    );
    expect(uploadStatusFor(state({ items: [queued("a")], online: false }), INSPECTION).message).toBe(
      "Offline: 1 photo waits on this device and uploads when the connection is back.",
    );
  });

  it("asks the inspector to act on uploads that stopped", () => {
    const items = [queued("a", { state: "failed" }), queued("b", { state: "failed" }), queued("c")];
    expect(uploadStatusFor(state({ items }), INSPECTION)).toMatchObject({
      failed: 2,
      pending: 3,
      blocking: true,
      message: "2 photos could not upload. Try again, or remove them.",
    });
  });

  it("does not block where uploads cannot run at all, and does where the store would not open", () => {
    const unconfigured = state({ phase: "unavailable", problem: QUEUE_PROBLEMS.notConfigured });
    expect(uploadStatusFor(unconfigured, INSPECTION)).toMatchObject({ ready: true, blocking: false, message: null });
    const broken = state({ phase: "unavailable", problem: QUEUE_PROBLEMS.failedToStart });
    expect(uploadStatusFor(broken, INSPECTION)).toMatchObject({ ready: false, blocking: true, message: QUEUE_PROBLEMS.failedToStart });
  });
});

describe("counting words and keys", () => {
  it("describes what waits", () => {
    expect(describeItems(1, 0)).toBe("1 photo");
    expect(describeItems(2, 1)).toBe("2 photos and 1 file");
    expect(describeItems(0, 3)).toBe("3 files");
    expect(describeItems(0, 0)).toBe("");
  });

  it("counts photos being prepared per inspection and drops an entry at zero", () => {
    let counts = bumpPreparing({}, INSPECTION, "photos", 2);
    counts = bumpPreparing(counts, INSPECTION, "files", 1);
    expect(counts).toEqual({ [INSPECTION]: { photos: 2, files: 1 } });
    counts = bumpPreparing(counts, INSPECTION, "photos", -3);
    expect(counts).toEqual({ [INSPECTION]: { photos: 0, files: 1 } });
    expect(bumpPreparing(counts, INSPECTION, "files", -1)).toEqual({});
  });

  it("keys a module's slot, the untagged slot included", () => {
    expect(moduleSlotKey(INSPECTION, "visual")).toBe(`${INSPECTION}:visual`);
    expect(moduleSlotKey(INSPECTION, null)).toBe(`${INSPECTION}:`);
  });
});
