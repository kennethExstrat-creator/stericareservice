"use client";

// Saving a photo's defect marks (Kenneth, 27 October 2026), drawn with the
// marking tool on Media's preview (photo-markup.tsx). Each change is kept on
// the page and saved 800 ms after the last one, as the capture screen's
// autosave waits, through savePhotoMarkers: one save at a time per photo, the
// newest marks always the last sent. The save belongs to the page, not to
// the preview: closing the preview sends what waits at once, and a save under
// way finishes and lands on the board (the media store: the marks, and the
// category the save moved the photo to) whether or not the preview is still
// open. A save that fails waits for Try Again, in the preview, or in a toast
// when the preview is closed.
import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { mediaStore } from "@/components/capture/photos/media-store";
import { sameMarkers } from "@/lib/photos/markers";
import type { PhotoMarker, PhotoSize } from "@/lib/schemas/photo-markers";
import { savePhotoMarkers, type SaveMarkersResult } from "../media-actions";
import { unreachable } from "./unreachable";

/** A change is saved this long after the last one. */
export const MARKER_SAVE_DELAY_MS = 800;

export type MarkerSaveView = {
  /** The marks on screen: the inspector's latest, saved or not; null while none was changed on this page. */
  markers: PhotoMarker[] | null;
  /** waiting: a change waits out its delay. saving: a save is under way. saved: the latest marks are kept. failed: they are not. */
  status: "idle" | "waiting" | "saving" | "saved" | "failed";
  /** Why the last save failed, in words for the inspector. */
  error: string | null;
  /** The module_key the last save moved the photo to (null: Other); null when it stayed. */
  moved: { moduleKey: string | null } | null;
};

const IDLE: MarkerSaveView = { markers: null, status: "idle", error: null, moved: null };

type Entry = {
  key: string;
  inspectionId: string;
  photoId: string;
  /** The photo's name for a toast: "Photo 3". */
  name: string;
  /** The latest marks: what is kept once the saves are through. */
  wanted: PhotoMarker[];
  /** The preview's natural size, saved with the marks of a photo stored without one. */
  size: PhotoSize | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The marks of the save under way. */
  sending: PhotoMarker[] | null;
  view: MarkerSaveView;
};

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const keyOf = (inspectionId: string, photoId: string) => `${inspectionId}:${photoId}`;

/** Hears of every change to one photo's save state; a photo watched is one whose preview is open. */
export function watchMarkerSave(inspectionId: string, photoId: string, listener: () => void): () => void {
  const key = keyOf(inspectionId, photoId);
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** One photo's save state now. */
export function markerSaveView(inspectionId: string, photoId: string): MarkerSaveView {
  return entries.get(keyOf(inspectionId, photoId))?.view ?? IDLE;
}

function show(entry: Entry, view: Partial<MarkerSaveView>): void {
  entry.view = { ...entry.view, ...view };
  for (const listener of [...(listeners.get(entry.key) ?? [])]) listener();
}

/** The save state of one photo's marks, for its preview. */
export function useMarkerSave(inspectionId: string, photoId: string): MarkerSaveView {
  return useSyncExternalStore(
    useCallback((listener: () => void) => watchMarkerSave(inspectionId, photoId, listener), [inspectionId, photoId]),
    () => markerSaveView(inspectionId, photoId),
    () => IDLE,
  );
}

/** The inspector changed a photo's marks: shown at once, saved after the delay. */
export function changeMarkers(
  inspectionId: string,
  photoId: string,
  markers: PhotoMarker[],
  { name, size }: { name: string; size: PhotoSize | null },
): void {
  const key = keyOf(inspectionId, photoId);
  const entry =
    entries.get(key) ??
    ({ key, inspectionId, photoId, name, wanted: markers, size: null, timer: null, sending: null, view: IDLE } satisfies Entry);
  entries.set(key, entry);
  entry.name = name;
  entry.wanted = markers;
  if (size) entry.size = size;
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void send(entry);
  }, MARKER_SAVE_DELAY_MS);
  show(entry, { markers, status: entry.sending ? "saving" : "waiting", error: null });
}

/**
 * The photo's preview is closing: a change still waiting out its delay is
 * sent at once. A save that is through says nothing more, so the preview
 * opens without it next time; one that failed still offers Try Again.
 */
export function flushMarkers(inspectionId: string, photoId: string): void {
  const entry = entries.get(keyOf(inspectionId, photoId));
  if (!entry) return;
  if (entry.timer === null) {
    if (entry.view.status === "saved") show(entry, { status: "idle", moved: null });
    return;
  }
  clearTimeout(entry.timer);
  entry.timer = null;
  void send(entry);
}

/** Try Again, after a save that failed. */
export function retryMarkers(inspectionId: string, photoId: string): void {
  const entry = entries.get(keyOf(inspectionId, photoId));
  if (!entry || entry.sending) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = null;
  void send(entry);
}

async function send(entry: Entry): Promise<void> {
  // One save at a time: the one under way sends the newest marks after it.
  if (entry.sending) return;
  const markers = entry.wanted;
  entry.sending = markers;
  show(entry, { status: "saving", error: null });
  let result: SaveMarkersResult;
  try {
    result = await savePhotoMarkers(entry.inspectionId, entry.photoId, markers, entry.size);
  } catch (thrown) {
    result = { ok: false, error: unreachable(thrown).message };
  }
  entry.sending = null;
  if (result.ok) {
    // The board shows the marks and the photo's new category at once.
    const store = mediaStore(entry.inspectionId);
    store.applyMarkers(entry.photoId, result.markers, result.size);
    if (result.moved) store.applyModuleKey("photo", entry.photoId, result.moved.moduleKey);
  }
  if (!sameMarkers(entry.wanted, markers)) {
    // Changed meanwhile: those marks go next, now if their delay is over.
    if (result.ok) show(entry, { moved: result.moved ?? null });
    if (entry.timer === null) void send(entry);
    else show(entry, { status: "waiting" });
    return;
  }
  if (!result.ok) {
    show(entry, { status: "failed", error: result.error });
    if (!listeners.has(entry.key)) {
      toast.error(`The defect marks on ${entry.name} were not saved.`, {
        description: result.error,
        action: { label: "Try Again", onClick: () => retryMarkers(entry.inspectionId, entry.photoId) },
      });
    }
    return;
  }
  show(entry, { status: "saved", error: null, moved: result.moved ?? null });
}

/** Forgets every photo's saves: for tests. */
export function resetMarkerSaves(): void {
  for (const entry of entries.values()) if (entry.timer !== null) clearTimeout(entry.timer);
  entries.clear();
  listeners.clear();
}
