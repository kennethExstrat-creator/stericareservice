// After a draft is deleted from the list: what this device still holds for it.
//
// Photos and files still waiting in this device's upload queue could never
// upload now. Storage and the photo tables refuse an inspection that is gone,
// and the queue keeps a refused item, as failed, for the inspector to retry
// or remove on the inspection's own screens, which no longer open. So they
// would stay on the device for good, and every Sign out would warn that
// photos are still only on this device (components/shell/sign-out-check.ts).
// They go as soon as the deletion has gone through, with the local copy of
// the draft's data (lib/offline/drafts.ts), which nothing would read again.
//
// Only this device, and only the signed-in user's own items: an upload
// queued on another iPad for the same draft is refused there.
//
// delete-inspection.tsx loads this module only after a deletion, so the
// queue's code stays out of the list until then (as with the sign-out check).
// The queue is the page's one store from components/capture/photos: the same
// instance the capture screen uses, through the methods its hooks use.
import type { PhotoQueueState } from "@/components/capture/photos/queue-state";
import { photoQueueStore, type PhotoQueueStore } from "@/components/capture/photos/queue-store";
import { getOfflineDatabase } from "@/lib/offline/db";
import { discardDraft, discardSetAsideDraft, listSetAsideDrafts } from "@/lib/offline/drafts";
import type { KeyValueStore } from "@/lib/offline/kv";

/** The draft that went, and whose device copies go now. */
export type DeletedDraft = { userId: string; inspectionId: string };

/** The parts of the page's upload queue used here. */
export type UploadQueueStore = Pick<PhotoQueueStore, "start" | "subscribe" | "getSnapshot" | "remove">;

/**
 * The longest wait for the queue to read what this device kept, and for
 * photos still being prepared for the draft (a burst just taken, seconds
 * each), so that none of them is queued after the rest have gone.
 */
export const QUEUE_WAIT_MS = 30_000;

export type QueueOutcome = {
  /** Items taken out of the queue. */
  discarded: number;
  /**
   * False when some may be left: the queue could not start, or did not read
   * this device's items in time, or an item could not be taken out.
   */
  complete: boolean;
};

/** The queue knows every item this device holds for the inspection, and no more are on their way. */
function knowsAll(state: PhotoQueueState, inspectionId: string): boolean {
  const preparing = state.preparing[inspectionId];
  return state.queue.load === "ready" && !(preparing && preparing.photos + preparing.files > 0);
}

/** True once `done` holds, false if `timeoutMs` passes first. */
function waitFor(store: UploadQueueStore, done: (state: PhotoQueueState) => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let over = false;
    const finish = (value: boolean) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const unsubscribe = store.subscribe(() => {
      if (done(store.getSnapshot())) finish(true);
    });
    if (done(store.getSnapshot())) finish(true);
  });
}

/**
 * Takes this device's queued photos and files for the inspection out of the
 * upload queue, with their bytes. Starts the queue for the user if no screen
 * has (as the capture screen would); one already running goes on as it is.
 */
export async function discardQueuedUploads(
  store: UploadQueueStore,
  { userId, inspectionId }: DeletedDraft,
  { timeoutMs = QUEUE_WAIT_MS }: { timeoutMs?: number } = {},
): Promise<QueueOutcome> {
  // Null: no queue can run here for this user, so there is nothing to reach.
  if (!(await store.start(userId))) return { discarded: 0, complete: false };
  const knewAll = await waitFor(store, (state) => knowsAll(state, inspectionId), timeoutMs);
  const ids = store
    .getSnapshot()
    .queue.items.filter((item) => item.inspectionId === inspectionId)
    .map((item) => item.id);
  let discarded = 0;
  let failed = false;
  for (const id of ids) {
    try {
      // False only says that its row existed or it had just finished: gone with the inspection either way.
      await store.remove(id);
      discarded++;
    } catch (error) {
      failed = true;
      console.error(`[inspections] A queued upload of deleted inspection ${inspectionId} could not be discarded`, error);
    }
  }
  return { discarded, complete: knewAll && !failed };
}

/** The local copy of the inspection's data, and any copy of it set aside as unreadable. */
export async function discardLocalCopies(drafts: KeyValueStore<unknown>, owner: DeletedDraft): Promise<void> {
  await discardDraft(drafts, owner);
  for (const copy of await listSetAsideDrafts(drafts, owner.userId)) {
    if (copy.inspectionId === owner.inspectionId) await discardSetAsideDraft(drafts, copy.key);
  }
}

/**
 * Forgets what this device holds for a draft its user just deleted. Never
 * rejects: the deletion itself went through, so a problem here is logged.
 */
export async function forgetDeletedDraft(draft: DeletedDraft): Promise<void> {
  const about = `deleted inspection ${draft.inspectionId}`;
  await Promise.all([
    discardQueuedUploads(photoQueueStore, draft).then(
      (outcome) => {
        if (!outcome.complete) console.warn(`[inspections] Queued uploads of ${about} may be left on this device`, outcome);
      },
      (error: unknown) => console.error(`[inspections] The upload queue could not be cleared of ${about}`, error),
    ),
    getOfflineDatabase()
      .then((db) => discardLocalCopies(db.store("drafts"), draft))
      .catch((error: unknown) => console.error(`[inspections] The local copy of ${about} could not be removed`, error)),
  ]);
}
