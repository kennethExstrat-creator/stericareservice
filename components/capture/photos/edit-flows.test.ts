// The edit and delete dialogs once submitted: a photo still on this device
// changes in the upload queue, an uploaded one through the Server Actions,
// a field error asks nobody, and a call that never got an answer comes back
// as words (the dialogs keep what was typed: their fields are controlled,
// which the photos e2e checks in a browser).
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  media: { applyPhoto: vi.fn(), removePhoto: vi.fn(), removeFile: vi.fn() },
  queue: {
    retag: vi.fn(async (): Promise<boolean> => true),
    remove: vi.fn(async (): Promise<boolean> => true),
    forgetPreview: vi.fn(),
  },
}));

vi.mock("@/lib/inspections/photos/actions", () => ({
  updatePhotoTags: vi.fn(),
  deletePhoto: vi.fn(),
  deleteInspectionFile: vi.fn(),
}));
vi.mock("./media-store", () => ({ mediaStore: vi.fn(() => fakes.media) }));
vi.mock("./queue-store", () => ({ photoQueueStore: fakes.queue }));

import { deleteInspectionFile, deletePhoto, updatePhotoTags } from "@/lib/inspections/photos/actions";
import { IDLE_PHOTO_ACTION, PHOTO_MESSAGES, type PhotoChange } from "@/lib/inspections/photos/messages";
import { deleteSlotFile, deleteSlotPhoto, REMOVED_FILE, REMOVED_PHOTO, savePhotoEdit } from "./edit-flows";
import { mediaStore } from "./media-store";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const FILE = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const UNREACHABLE = "Could not reach the server. Check the connection and try again.";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const retagForm = (patch: Record<string, string> = {}) =>
  form({ photoId: PHOTO, moduleKey: "dispensing_packing", size: "M", box: "12", caption: "Torn box corner", ...patch });

const change: PhotoChange = { id: PHOTO, moduleKey: "dispensing_packing", target: "size:M/box:12", caption: "Torn box corner", includeInReport: false };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const mock of [fakes.media.applyPhoto, fakes.media.removePhoto, fakes.media.removeFile, fakes.queue.forgetPreview]) mock.mockClear();
  fakes.queue.retag.mockReset().mockResolvedValue(true);
  fakes.queue.remove.mockReset().mockResolvedValue(true);
  vi.mocked(updatePhotoTags).mockReset();
  vi.mocked(deletePhoto).mockReset();
  vi.mocked(deleteInspectionFile).mockReset();
  vi.mocked(mediaStore).mockClear();
});

describe("savePhotoEdit", () => {
  it("checks the fields first: a field error asks neither the device nor the server", async () => {
    const result = await savePhotoEdit(INSPECTION, { id: PHOTO, queued: true }, IDLE_PHOTO_ACTION, retagForm({ box: "abc" }));
    expect(result).toEqual({ status: "error", message: PHOTO_MESSAGES.checkFields, fieldErrors: { box: "Enter the box number in digits." } });
    expect(fakes.queue.retag).not.toHaveBeenCalled();
    expect(updatePhotoTags).not.toHaveBeenCalled();
  });

  it("retags a photo still on this device in the queue, which works offline", async () => {
    const result = await savePhotoEdit(INSPECTION, { id: PHOTO, queued: true }, IDLE_PHOTO_ACTION, retagForm());
    expect(result).toEqual({ status: "success", message: PHOTO_MESSAGES.updated });
    expect(fakes.queue.retag).toHaveBeenCalledWith(PHOTO, {
      tag: { moduleKey: "dispensing_packing", target: { size: "M", box: 12 } },
      caption: "Torn box corner",
    });
    expect(updatePhotoTags).not.toHaveBeenCalled();
  });

  it("sends the change to the server once the photo has left the queue, and the page's copy follows the answer", async () => {
    fakes.queue.retag.mockResolvedValue(false);
    vi.mocked(updatePhotoTags).mockResolvedValue({ status: "success", message: PHOTO_MESSAGES.updated, photo: change });
    const result = await savePhotoEdit(INSPECTION, { id: PHOTO, queued: true }, IDLE_PHOTO_ACTION, retagForm());
    expect(result.status).toBe("success");
    expect(mediaStore).toHaveBeenCalledWith(INSPECTION);
    expect(fakes.media.applyPhoto).toHaveBeenCalledWith(change);
  });

  it("saves an uploaded photo through the server only", async () => {
    vi.mocked(updatePhotoTags).mockResolvedValue({ status: "success", message: PHOTO_MESSAGES.updated, photo: change });
    await savePhotoEdit(INSPECTION, { id: PHOTO, queued: false }, IDLE_PHOTO_ACTION, retagForm());
    expect(fakes.queue.retag).not.toHaveBeenCalled();
    expect(vi.mocked(updatePhotoTags).mock.calls[0][1].get("caption")).toBe("Torn box corner");
    expect(fakes.media.applyPhoto).toHaveBeenCalledWith(change);
  });

  it("answers a save that never reached the server in words, changing nothing here", async () => {
    vi.mocked(updatePhotoTags).mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await savePhotoEdit(INSPECTION, { id: PHOTO, queued: false }, IDLE_PHOTO_ACTION, retagForm());
    expect(result).toEqual({ status: "error", message: UNREACHABLE });
    expect(fakes.media.applyPhoto).not.toHaveBeenCalled();
  });

  it("passes a refusal on as it came", async () => {
    vi.mocked(updatePhotoTags).mockResolvedValue({ status: "error", message: PHOTO_MESSAGES.forbidden });
    expect(await savePhotoEdit(INSPECTION, { id: PHOTO, queued: false }, IDLE_PHOTO_ACTION, retagForm())).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.forbidden,
    });
    expect(fakes.media.applyPhoto).not.toHaveBeenCalled();
  });
});

describe("deleteSlotPhoto", () => {
  const data = () => form({ photoId: PHOTO });

  it("takes a photo still on this device off it, without the server", async () => {
    expect(await deleteSlotPhoto(INSPECTION, { id: PHOTO, queued: true }, IDLE_PHOTO_ACTION, data())).toEqual({
      status: "success",
      message: REMOVED_PHOTO,
      removedId: PHOTO,
    });
    expect(fakes.queue.remove).toHaveBeenCalledWith(PHOTO);
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it("deletes through the server a photo that finished uploading while the dialog was open", async () => {
    fakes.queue.remove.mockResolvedValue(false);
    vi.mocked(deletePhoto).mockResolvedValue({ status: "success", message: PHOTO_MESSAGES.deleted, removedId: PHOTO });
    const result = await deleteSlotPhoto(INSPECTION, { id: PHOTO, queued: true }, IDLE_PHOTO_ACTION, data());
    expect(result).toMatchObject({ status: "success", message: PHOTO_MESSAGES.deleted });
    expect(fakes.media.removePhoto).toHaveBeenCalledWith(PHOTO);
    expect(fakes.queue.forgetPreview).toHaveBeenCalledWith(PHOTO);
  });

  it("deletes an uploaded photo through the server only, and keeps it when the server is not reached", async () => {
    vi.mocked(deletePhoto).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await deleteSlotPhoto(INSPECTION, { id: PHOTO, queued: false }, IDLE_PHOTO_ACTION, data())).toEqual({
      status: "error",
      message: UNREACHABLE,
    });
    expect(fakes.queue.remove).not.toHaveBeenCalled();
    expect(fakes.media.removePhoto).not.toHaveBeenCalled();
  });
});

describe("deleteSlotFile", () => {
  const data = () => form({ fileId: FILE });

  it("takes a queued file off this device, and deletes an uploaded one through the server", async () => {
    expect(await deleteSlotFile(INSPECTION, { id: FILE, queued: true }, IDLE_PHOTO_ACTION, data())).toMatchObject({
      status: "success",
      message: REMOVED_FILE,
    });
    expect(deleteInspectionFile).not.toHaveBeenCalled();

    vi.mocked(deleteInspectionFile).mockResolvedValue({ status: "success", message: PHOTO_MESSAGES.fileDeleted, removedId: FILE });
    await deleteSlotFile(INSPECTION, { id: FILE, queued: false }, IDLE_PHOTO_ACTION, data());
    expect(fakes.media.removeFile).toHaveBeenCalledWith(FILE);
  });

  it("keeps the file when the server refuses", async () => {
    vi.mocked(deleteInspectionFile).mockResolvedValue({ status: "error", message: PHOTO_MESSAGES.fileGone });
    expect(await deleteSlotFile(INSPECTION, { id: FILE, queued: false }, IDLE_PHOTO_ACTION, data())).toEqual({
      status: "error",
      message: PHOTO_MESSAGES.fileGone,
    });
    expect(fakes.media.removeFile).not.toHaveBeenCalled();
  });
});
