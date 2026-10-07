"use client";

// React access to the page's upload queue and to an inspection's uploaded
// photos and files. The stores are browser-only singletons; on the server
// (and while hydrating) the hooks answer with the first state, or with the
// copy the gallery page rendered, so the markup always matches.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { InspectionMedia } from "@/lib/inspections/photos/queries";
import { autoTag } from "@/lib/photos/target";
import { IDLE_MEDIA, mediaStore, type MediaState } from "./media-store";
import { uploadStatusFor, type PhotoUploadStatus } from "./photo-model";
import type { PhotoQueueState } from "./queue-state";
import { photoQueueStore } from "./queue-store";

/** What the capture screen has in focus (modules/_framework CaptureFocus, nulls allowed). */
export interface PhotoFocus {
  readonly size?: string | null;
  readonly hand?: "R" | "L" | null;
  readonly defect?: string | null;
  readonly box?: number | null;
  /** Labelling's packaging level. */
  readonly level?: "inner" | "carton" | null;
  /** An entry of the module's own list: a document, a loading stage. */
  readonly item?: string | null;
}

/** The signed-in user, from PhotoQueueProvider. Null: the queue reads it from the session. */
export const PhotoUserContext = createContext<string | null>(null);

/** The gallery's server copy of an inspection's media, seeding the store before hydration. */
export const MediaSeedContext = createContext<InspectionMedia | null>(null);

const noSubscription = () => () => undefined;

/** The page's upload queue state: items, progress, previews, what is being prepared. */
export function usePhotoQueue(): PhotoQueueState {
  return useSyncExternalStore(photoQueueStore.subscribe, photoQueueStore.getSnapshot, photoQueueStore.getServerSnapshot);
}

/** Starts the page's queue for the provider's user, or the session's. Every photo screen calls it. */
export function useStartPhotoQueue(): void {
  const userId = useContext(PhotoUserContext);
  useEffect(() => {
    if (userId) void photoQueueStore.start(userId);
    else photoQueueStore.startFromSession();
  }, [userId]);
}

/**
 * An inspection's uploaded photos and files, its tag options and the user's
 * rights on it. Loads them on first use (the browser's Supabase client, RLS
 * applies) unless the gallery handed over its server copy.
 */
export function useInspectionMedia(inspectionId: string): MediaState {
  const seed = useContext(MediaSeedContext);
  const matching = seed && seed.inspection.id === inspectionId ? seed : null;
  const store = useMemo(() => (typeof window === "undefined" ? null : mediaStore(inspectionId)), [inspectionId]);
  const serverState = useMemo<MediaState>(
    () => (matching ? { status: "ready", media: matching, error: null } : IDLE_MEDIA),
    [matching],
  );
  // Seeding is idempotent (a newer copy wins), and runs before the store is read below.
  if (store && matching) store.seed(matching, { silent: true });
  const state = useSyncExternalStore(
    store ? store.subscribe : noSubscription,
    store ? store.getSnapshot : () => serverState,
    () => serverState,
  );
  useEffect(() => {
    if (!store) return;
    // A seed applied while rendering told nobody; tell the other subscribers now.
    store.notify();
    store.ensureLoaded();
  }, [store, matching]);
  return state;
}

/**
 * Loads an inspection's photos, files and the user's rights on them again,
 * keeping what is on screen meanwhile: for a screen that changed the
 * inspection's status itself (submit, reopen, approve) and stays where it is.
 * Screens shown again after client-side navigation load again by themselves.
 */
export function refreshInspectionMedia(inspectionId: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return mediaStore(inspectionId).load();
}

/**
 * The upload state of an inspection, for the capture screen: a pending
 * badge, and a submit button that waits while `blocking` (BUILD_SPEC 8.1),
 * with `message` as the reason. Check `photoUploadsSettled()` once more on
 * submit: it also counts photos another tab queued.
 */
export function usePhotoUploadStatus(inspectionId: string): PhotoUploadStatus {
  useStartPhotoQueue();
  const state = usePhotoQueue();
  return useMemo(() => uploadStatusFor(state, inspectionId), [state, inspectionId]);
}

/**
 * The submit check: nothing being prepared and nothing waiting on this
 * device for the inspection, other tabs included. Without an inspection:
 * nothing waiting at all, e.g. before signing out.
 */
export function photoUploadsSettled(inspectionId?: string): Promise<boolean> {
  return photoQueueStore.isSettled(inspectionId);
}

/**
 * Stops the page's uploads, for the sign-out flow (docs/OFFLINE.md, "What the
 * capture screen wires"): ask photoUploadsSettled() first and warn while it is
 * false, since those photos are only on this device until they upload. Kept
 * items resume when their user next opens a photo screen on this device.
 */
export function stopPhotoQueue(): void {
  photoQueueStore.stop();
}

/**
 * Adds photos to the upload queue, tagged with the module and what is in
 * focus at the moment they are added (BUILD_SPEC 8.1). For ModuleCard's
 * own "Take photo" and "Add from library": `onFiles={addPhotos}`.
 */
export function useAddPhotos({
  inspectionId,
  moduleKey,
  focus,
}: {
  inspectionId: string;
  moduleKey: string | null;
  focus?: PhotoFocus | null;
}): (files: readonly File[]) => void {
  useStartPhotoQueue();
  // The focus at the moment of the tap, not at the last render that made the callback.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);
  return useCallback(
    (files: readonly File[]) => {
      const tag = moduleKey === null ? { moduleKey: null, target: {} } : autoTag({ moduleKey, ...(focusRef.current ?? {}) });
      photoQueueStore.addPhotos({ inspectionId, files, tag });
    },
    [inspectionId, moduleKey],
  );
}
