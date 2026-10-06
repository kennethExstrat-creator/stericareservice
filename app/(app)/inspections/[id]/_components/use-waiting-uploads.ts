"use client";

// Photos and files of this inspection still waiting on this device
// (BUILD_SPEC 8.1: a badge shows pending uploads; submit is blocked until
// the queue is empty). The photo build owns the upload queue that sends
// them; this screen only reads what the queue keeps in IndexedDB, so it
// never uploads (or competes with that queue) itself:
//
// - the badge counts this inspection's items in the queue's store, every
//   few seconds while the page is visible;
// - before submitting, isEmptyNow() asks lib/photos' own check on a queue
//   that is never started, which reads the same store.
import { useCallback, useEffect, useRef, useState } from "react";
import { countWaitingUploads } from "@/lib/inspections/capture/uploads";
import { getOfflineDatabase } from "@/lib/offline";
import { createUploadQueue, type MediaRepository, type UploadQueue, type UploadStorage } from "@/lib/photos";

const POLL_MS = 3_000;

// The read-only queue is never started, so these are never called.
const NO_STORAGE: UploadStorage = {
  upload: async () => ({ ok: false, reason: "forbidden", message: "This queue only reads." }),
};
const NO_REPOSITORY: MediaRepository = {
  insertPhoto: async () => ({ ok: false, reason: "forbidden", message: "This queue only reads." }),
  updatePhoto: async () => ({ ok: false, reason: "forbidden", message: "This queue only reads." }),
  insertFile: async () => ({ ok: false, reason: "forbidden", message: "This queue only reads." }),
};

export type WaitingUploads = {
  /** Items waiting for this inspection; null until the first read. */
  count: number | null;
  /** The submit check: nothing of this inspection waits on this device. */
  isEmptyNow: () => Promise<boolean>;
};

export function useWaitingUploads({ inspectionId, userId }: { inspectionId: string; userId: string }): WaitingUploads {
  const [count, setCount] = useState<number | null>(null);
  const queue = useRef<Promise<UploadQueue> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      clearTimeout(timer);
      try {
        const db = await getOfflineDatabase();
        const rows = await db.store("uploads").getAll();
        if (!cancelled) setCount(countWaitingUploads(rows, { userId, inspectionId }));
      } catch {
        // IndexedDB refused: the count stays as it was; submit asks the queue again.
      }
      if (!cancelled && document.visibilityState === "visible") timer = setTimeout(read, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [inspectionId, userId]);

  const isEmptyNow = useCallback(async () => {
    queue.current ??= getOfflineDatabase().then((db) =>
      createUploadQueue({
        userId,
        items: db.store("uploads"),
        blobs: db.store("upload-blobs"),
        persistent: db.persistent,
        storage: NO_STORAGE,
        repository: NO_REPOSITORY,
      }),
    );
    const reader = await queue.current;
    const empty = await reader.isEmptyNow(inspectionId);
    if (empty) setCount(0);
    return empty;
  }, [inspectionId, userId]);

  return { count, isEmptyNow };
}
