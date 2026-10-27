import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../media-actions", () => ({ savePhotoMarkers: vi.fn() }));
vi.mock("@/components/capture/photos/media-store", () => ({ mediaStore: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { mediaStore } from "@/components/capture/photos/media-store";
import type { PhotoMarker } from "@/lib/schemas/photo-markers";
import { savePhotoMarkers, type SaveMarkersResult } from "../media-actions";
import {
  changeMarkers,
  flushMarkers,
  MARKER_SAVE_DELAY_MS,
  markerSaveView,
  resetMarkerSaves,
  retryMarkers,
  watchMarkerSave,
} from "./marker-saves";
import { UNREACHABLE_MESSAGE } from "./unreachable";

// Saving a photo's defect marks from Media's preview (Kenneth, 27 October
// 2026): each change shown at once and saved 800 ms after the last, one save
// at a time, the newest marks last; a save outlives the preview.

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ONE: PhotoMarker[] = [{ x: 0.5, y: 0.5, r: 0.1 }];
const TWO: PhotoMarker[] = [...ONE, { x: 0.56, y: 0.56, r: 0.1 }];

const applyMarkers = vi.fn();
const applyModuleKey = vi.fn();

/** savePhotoMarkers' answers, one per call, each when the test resolves it. */
const answers: Array<(result: SaveMarkersResult) => void> = [];

const change = (markers: PhotoMarker[]) => changeMarkers(INSPECTION, PHOTO, markers, { name: "Photo 3", size: { width: 2048, height: 1536 } });
const view = () => markerSaveView(INSPECTION, PHOTO);
const answer = async (result: SaveMarkersResult) => {
  answers.shift()?.(result);
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(mediaStore).mockReturnValue({ applyMarkers, applyModuleKey } as never);
  vi.mocked(savePhotoMarkers).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetMarkerSaves();
  answers.length = 0;
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("saving a photo's marks", () => {
  it("shows a change at once and saves the last of several 800 ms after it", async () => {
    change(ONE);
    expect(view()).toMatchObject({ markers: ONE, status: "waiting" });
    await vi.advanceTimersByTimeAsync(MARKER_SAVE_DELAY_MS - 100);
    change(TWO);
    await vi.advanceTimersByTimeAsync(MARKER_SAVE_DELAY_MS - 1);
    expect(savePhotoMarkers).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(savePhotoMarkers).toHaveBeenCalledTimes(1);
    expect(savePhotoMarkers).toHaveBeenCalledWith(INSPECTION, PHOTO, TWO, { width: 2048, height: 1536 });
    expect(view().status).toBe("saving");

    await answer({ ok: true, markers: TWO, size: null });
    expect(view()).toEqual({ markers: TWO, status: "saved", error: null, moved: null });
    // The board's copy: the marks as saved.
    expect(applyMarkers).toHaveBeenCalledWith(PHOTO, TWO, null);
    expect(applyModuleKey).not.toHaveBeenCalled();
  });

  it("puts the photo where the save moved it, with the size saved beside its marks", async () => {
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    await answer({ ok: true, markers: ONE, moved: { moduleKey: "media_defects" }, size: { width: 2048, height: 1536 } });
    expect(applyMarkers).toHaveBeenCalledWith(PHOTO, ONE, { width: 2048, height: 1536 });
    expect(applyModuleKey).toHaveBeenCalledWith("photo", PHOTO, "media_defects");
    expect(view()).toMatchObject({ status: "saved", moved: { moduleKey: "media_defects" } });
  });

  it("sends what waits at once when the preview closes, and nothing when nothing waits", async () => {
    flushMarkers(INSPECTION, PHOTO);
    expect(savePhotoMarkers).not.toHaveBeenCalled();
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    expect(savePhotoMarkers).toHaveBeenCalledTimes(1);
    // The delay's own save never follows.
    await vi.advanceTimersByTimeAsync(MARKER_SAVE_DELAY_MS * 2);
    expect(savePhotoMarkers).toHaveBeenCalledTimes(1);

    // Saved once the preview has closed: the next preview opens with the marks and no status.
    await answer({ ok: true, markers: ONE, moved: { moduleKey: "media_defects" }, size: null });
    expect(view()).toMatchObject({ status: "saved", moved: { moduleKey: "media_defects" } });
    flushMarkers(INSPECTION, PHOTO);
    expect(view()).toEqual({ markers: ONE, status: "idle", error: null, moved: null });
    expect(savePhotoMarkers).toHaveBeenCalledTimes(1);
  });

  it("saves one at a time: marks changed during a save go after it, the newest last", async () => {
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    change(TWO);
    await vi.advanceTimersByTimeAsync(MARKER_SAVE_DELAY_MS);
    // Its delay is over, but the first save has not answered.
    expect(savePhotoMarkers).toHaveBeenCalledTimes(1);
    expect(view()).toMatchObject({ markers: TWO, status: "saving" });

    await answer({ ok: true, markers: ONE, moved: { moduleKey: "media_defects" }, size: null });
    expect(savePhotoMarkers).toHaveBeenCalledTimes(2);
    expect(vi.mocked(savePhotoMarkers).mock.calls[1][2]).toEqual(TWO);
    expect(view()).toMatchObject({ markers: TWO, status: "saving" });

    await answer({ ok: true, markers: TWO, size: null });
    expect(view()).toMatchObject({ markers: TWO, status: "saved", moved: null });
  });

  it("keeps a failed save's marks on screen until Try Again saves them", async () => {
    const stop = watchMarkerSave(INSPECTION, PHOTO, () => {});
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    await answer({ ok: false, error: "The server did not answer. Try again in a moment." });
    expect(view()).toMatchObject({ markers: ONE, status: "failed", error: "The server did not answer. Try again in a moment." });
    expect(applyMarkers).not.toHaveBeenCalled();
    // The preview is open: it says so itself.
    expect(toast.error).not.toHaveBeenCalled();

    retryMarkers(INSPECTION, PHOTO);
    expect(savePhotoMarkers).toHaveBeenCalledTimes(2);
    expect(view()).toMatchObject({ status: "saving", error: null });
    await answer({ ok: true, markers: ONE, size: null });
    expect(view().status).toBe("saved");
    stop();
  });

  it("says so in a toast, with Try Again, when the preview was closed before the save failed", async () => {
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    vi.mocked(savePhotoMarkers).mockClear();
    answers.shift()?.({ ok: false, error: "This photo was deleted, or it can no longer be changed from this account." });
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.error).toHaveBeenCalledWith("The defect marks on Photo 3 were not saved.", {
      description: "This photo was deleted, or it can no longer be changed from this account.",
      action: { label: "Try Again", onClick: expect.any(Function) },
    });
    const action = vi.mocked(toast.error).mock.calls[0][1]?.action as unknown as { onClick: () => void };
    action.onClick();
    expect(savePhotoMarkers).toHaveBeenCalledWith(INSPECTION, PHOTO, ONE, { width: 2048, height: 1536 });
  });

  it("treats a call that never got an answer as a failed save", async () => {
    vi.mocked(savePhotoMarkers).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    change(ONE);
    flushMarkers(INSPECTION, PHOTO);
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchObject({ status: "failed", error: UNREACHABLE_MESSAGE });
  });

  it("tells whoever watches of every change", async () => {
    const heard = vi.fn();
    const stop = watchMarkerSave(INSPECTION, PHOTO, heard);
    change(ONE);
    expect(heard).toHaveBeenCalledTimes(1);
    flushMarkers(INSPECTION, PHOTO);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    await answer({ ok: true, markers: ONE, size: null });
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
