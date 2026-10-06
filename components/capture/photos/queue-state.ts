// The page's upload queue as the photo screens read it (queue-store.ts holds
// the queue itself), with its words and the counting rules. Pure and free of
// browser code, so photo-model's rules are unit-tested without IndexedDB or
// Supabase.
import type { UploadQueueSnapshot } from "@/lib/photos/upload-queue";

export type QueuePhase =
  /** Not started: no photo screen has asked for it yet. */
  | "idle"
  /** Opening the local database and reading what this device kept. */
  | "starting"
  | "ready"
  /** No Supabase settings, or no signed-in user: nothing can be queued. */
  | "unavailable";

export interface PreparingCount {
  photos: number;
  files: number;
}

export interface PhotoQueueState {
  phase: QueuePhase;
  userId: string | null;
  /** Why the queue is unavailable, in words. */
  problem: string | null;
  queue: UploadQueueSnapshot;
  /** Photos and files being prepared, by inspection: the queue does not know them yet. */
  preparing: Readonly<Record<string, PreparingCount>>;
  /** The same, by `<inspection id>:<module key>` (moduleSlotKey), for the slot that is adding them. */
  preparingByModule: Readonly<Record<string, PreparingCount>>;
  /**
   * Local previews of photos added on this page, by id: an object URL, or
   * null when there is none (an original the browser cannot show). Kept after
   * the upload, so a tile does not flash while its signed URL loads.
   */
  previews: Readonly<Record<string, string | null>>;
}

export const NOTHING_PREPARING: PreparingCount = { photos: 0, files: 0 };

export const EMPTY_QUEUE_SNAPSHOT: UploadQueueSnapshot = {
  load: "loading",
  items: [],
  pending: 0,
  failed: 0,
  online: true,
  retryAt: null,
  error: null,
  retagFailures: [],
  localCopy: true,
};

export const INITIAL_QUEUE_STATE: PhotoQueueState = {
  phase: "idle",
  userId: null,
  problem: null,
  queue: EMPTY_QUEUE_SNAPSHOT,
  preparing: {},
  preparingByModule: {},
  previews: {},
};

export const QUEUE_PROBLEMS = {
  notConfigured: "Photo uploads are not set up on this server.",
  signedOut: "Sign in again to add photos.",
  failedToStart: "This device could not open its photo store. Reload the page and try again.",
} as const;

/** The key of one module's slot in `preparingByModule`. */
export function moduleSlotKey(inspectionId: string, moduleKey: string | null): string {
  return `${inspectionId}:${moduleKey ?? ""}`;
}

/** Counts `by` more (or fewer) photos or files being prepared under `key`; an entry that reaches zero goes. */
export function bumpPreparing(
  counts: Readonly<Record<string, PreparingCount>>,
  key: string,
  kind: keyof PreparingCount,
  by: number,
): Record<string, PreparingCount> {
  const current = counts[key] ?? NOTHING_PREPARING;
  const next = { ...current, [kind]: Math.max(0, current[kind] + by) };
  const result = { ...counts, [key]: next };
  if (next.photos + next.files === 0) delete result[key];
  return result;
}
