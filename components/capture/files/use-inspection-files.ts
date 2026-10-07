"use client";

// The inspection's files as the modules decide with them (InspectionMeta.files,
// docs/MODULES.md 10.1): the uploaded rows from the page's media store and the
// files still queued on this device, null until both are known. A lab report
// deleted in a file slot or in the gallery drops out at once, and one added in
// the gallery counts for its module. The screen re-renders only when the list
// says something new: never for an upload's progress.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useStartPhotoQueue } from "@/components/capture/photos/hooks";
import { IDLE_MEDIA, mediaStore, type MediaState } from "@/components/capture/photos/media-store";
import { inspectionFileRefs, type FileRef } from "@/components/capture/photos/photo-model";
import type { PhotoQueueState } from "@/components/capture/photos/queue-state";
import { photoQueueStore } from "@/components/capture/photos/queue-store";

/** The refs as text: equal text, nothing new to evaluate. */
function describe(media: MediaState, queue: PhotoQueueState, inspectionId: string): string {
  const loaded = media.status === "ready" && media.media !== null ? media.media.files : null;
  return JSON.stringify(inspectionFileRefs({ files: loaded, queue, inspectionId }));
}

const UNKNOWN = JSON.stringify(null);

export function useInspectionFiles(inspectionId: string): readonly FileRef[] | null {
  useStartPhotoQueue();
  const store = useMemo(() => (typeof window === "undefined" ? null : mediaStore(inspectionId)), [inspectionId]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const fromQueue = photoQueueStore.subscribe(listener);
      const fromMedia = store?.subscribe(listener);
      return () => {
        fromQueue();
        fromMedia?.();
      };
    },
    [store],
  );
  const read = useCallback(
    () => describe(store?.getSnapshot() ?? IDLE_MEDIA, photoQueueStore.getSnapshot(), inspectionId),
    [store, inspectionId],
  );
  const said = useSyncExternalStore(subscribe, read, () => UNKNOWN);
  useEffect(() => {
    store?.ensureLoaded();
  }, [store]);
  return useMemo(() => JSON.parse(said) as FileRef[] | null, [said]);
}
