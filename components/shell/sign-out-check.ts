// What Sign out would leave behind, asked before it signs out: photos and
// files still waiting on this device (BUILD_SPEC 8.1: they upload in the
// background and only for the user who took them) and any page's unsaved
// work (./leave-guard.ts). Nothing found: Sign out goes ahead at once.
// Anything found, or a check that cannot answer: the user is asked first.
//
// Pure apart from loadPhotoQueue(), which loads the photo queue's sign-out
// API on demand, so its code stays out of the shell on every other page.
import { unstable_rethrow } from "next/navigation";
import type { LeaveGuards } from "./leave-guard";

export const SIGN_OUT_FAILED = "You are still signed in";
export const SIGN_OUT_FAILED_DETAIL = "Signing out did not reach the server. Check the connection and try again.";

/**
 * True for Next.js's own control flow, such as the Server Action's redirect
 * to /login once it has signed out: it must be rethrown, and it means the
 * sign-out happened. Anything else is a failure: the user is still signed in.
 */
export function isNavigationSignal(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

/** The two calls of @/components/capture/photos that sign-out needs. */
export type PhotoQueueApi = {
  /** photoUploadsSettled() with no inspection: nothing waiting on this device, other tabs included. */
  settled: () => Promise<boolean>;
  /** stopPhotoQueue(): the queue lets go of this user; what is kept resumes at their next sign-in here. */
  stop: () => void;
};

let photoQueue: Promise<PhotoQueueApi> | null = null;

/**
 * The photo queue, loaded once (the account menu starts it when it opens).
 * The same module instance as the photo screens', so it sees their queue.
 * A load that fails, for example offline, is tried again next time.
 */
export function loadPhotoQueue(): Promise<PhotoQueueApi> {
  if (!photoQueue) {
    const loading = import("@/components/capture/photos").then(
      (photos): PhotoQueueApi => ({
        settled: () => photos.photoUploadsSettled(),
        stop: () => photos.stopPhotoQueue(),
      }),
    );
    photoQueue = loading;
    loading.catch(() => {
      if (photoQueue === loading) photoQueue = null;
    });
  }
  return photoQueue;
}

export const UPLOADS_WAITING =
  "Some photos or files are still only on this device. They will not upload while you are signed out: they upload when you next sign in here and open an inspection.";

export const UPLOADS_UNCHECKED = "This device could not check whether photos or files are still waiting to upload.";

/** How long loading the queue's code may take (a slow connection), then how long its check may take. */
export const QUEUE_LOAD_TIMEOUT_MS = 15_000;
export const UPLOADS_CHECK_TIMEOUT_MS = 5_000;

export type UploadsOnDevice = "none" | "waiting" | "unknown";

const TIMED_OUT = Symbol("timed out");

function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Whether photos or files wait on this device; "unknown" when the queue cannot say in time. */
export async function uploadsOnDevice(
  load: () => Promise<PhotoQueueApi> = loadPhotoQueue,
  { loadTimeoutMs = QUEUE_LOAD_TIMEOUT_MS, checkTimeoutMs = UPLOADS_CHECK_TIMEOUT_MS } = {},
): Promise<UploadsOnDevice> {
  try {
    const queue = await within(load(), loadTimeoutMs);
    if (queue === TIMED_OUT) return "unknown";
    const settled = await within(queue.settled(), checkTimeoutMs);
    if (settled === TIMED_OUT) return "unknown";
    return settled ? "none" : "waiting";
  } catch (error) {
    console.error("Sign out: the photo uploads could not be checked", error);
    return "unknown";
  }
}

/**
 * The reasons to ask before signing out, uploads first, then each page's
 * unsaved work. Empty: sign out at once. Both checks run together.
 */
export async function reasonsBeforeSignOut({
  uploads,
  guards,
}: {
  uploads: () => Promise<UploadsOnDevice>;
  guards: Pick<LeaveGuards, "check">;
}): Promise<string[]> {
  const [onDevice, work] = await Promise.all([uploads(), guards.check("sign-out")]);
  const upload = onDevice === "waiting" ? [UPLOADS_WAITING] : onDevice === "unknown" ? [UPLOADS_UNCHECKED] : [];
  return [...upload, ...work];
}
