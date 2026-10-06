// The page's one upload queue (docs/OFFLINE.md, "What the capture screen
// wires"), shared by every photo slot, file slot and gallery in the tab. It
// lives for the life of the page, not of a screen: uploads carry on while
// the inspector moves between modules or back to the list.
//
// Capture never waits (BUILD_SPEC 8.1). A chosen photo is counted as being
// prepared at once, processed in the browser one at a time (memory), handed
// to the queue, and uploads in the background with retries. Everything here
// runs in the browser only; on the server the store stays in its first state.
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { getSupabasePublicEnv } from "@/lib/env";
import { getOfflineDatabase, requestPersistentStorage } from "@/lib/offline/db";
import { FAILURE_MESSAGES } from "@/lib/offline/failures";
import { browserCodec } from "@/lib/photos/browser-codec";
import { prepareFile, type InspectionFileKind } from "@/lib/photos/files";
import { processPhoto } from "@/lib/photos/process";
import { supabaseRepository, supabaseStorage } from "@/lib/photos/supabase-adapters";
import type { PhotoTag } from "@/lib/photos/target";
import {
  createUploadQueue,
  type MediaRepository,
  type TransferOutcome,
  type UploadItem,
  type UploadQueue,
} from "@/lib/photos/upload-queue";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import {
  bumpPreparing,
  INITIAL_QUEUE_STATE,
  moduleSlotKey,
  QUEUE_PROBLEMS,
  type PhotoQueueState,
  type PreparingCount,
} from "./queue-state";

/** Types a browser shows as they are: an original kept unconverted can still be its own preview. */
const SHOWABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Items the queue let go of without this page removing them: uploaded (here or in another tab). */
export type SettledListener = (items: readonly UploadItem[]) => void;

/** A retag or caption the server took for a photo whose row this page has not read yet. */
export type SettledChange = Pick<UploadItem, "id" | "moduleKey" | "target" | "caption">;

export interface AddPhotosInput {
  inspectionId: string;
  files: readonly File[];
  tag: PhotoTag;
}

export interface AddFilesInput {
  inspectionId: string;
  moduleKey: string | null;
  kind: InspectionFileKind;
  files: readonly File[];
  /** Called with each file's future inspection_files id once it is kept on this device. */
  onQueued?: (file: { id: string; name: string }) => void;
}

/** Exported for tests; the app uses the one `photoQueueStore` below. */
export class PhotoQueueStore {
  private state: PhotoQueueState = INITIAL_QUEUE_STATE;
  private queue: UploadQueue | null = null;
  private starting: Promise<UploadQueue | null> | null = null;
  /** The session lookup of startFromSession() in flight, if any. */
  private sessionLookup: object | null = null;
  private stopListening: (() => void) | null = null;
  private lastItems = new Map<string, UploadItem>();
  /** Items this page took out of the queue: their leaving is not an upload. */
  private readonly removedHere = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly settledListeners = new Set<SettledListener>();
  /** Photos are processed one at a time: a burst of library photos must not fill the iPad's memory. */
  private chain: Promise<void> = Promise.resolve();
  private readonly previewLoads = new Set<string>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PhotoQueueState => this.state;

  readonly getServerSnapshot = (): PhotoQueueState => INITIAL_QUEUE_STATE;

  onSettled(listener: SettledListener): () => void {
    this.settledListeners.add(listener);
    return () => {
      this.settledListeners.delete(listener);
    };
  }

  /**
   * Starts the queue for this user: once per page, again only when another
   * user signs in on it. Items the device kept from earlier pages resume.
   */
  start(userId: string): Promise<UploadQueue | null> {
    if (typeof window === "undefined" || !userId) return Promise.resolve(null);
    if (this.state.userId === userId && this.starting) return this.starting;
    // A session lookup still running gives way to the user named here.
    this.sessionLookup = null;
    this.stopCurrent();

    const env = getSupabasePublicEnv();
    if (!env) {
      this.starting = Promise.resolve(null);
      this.setState({ phase: "unavailable", userId, problem: QUEUE_PROBLEMS.notConfigured });
      return this.starting;
    }
    this.setState({ phase: "starting", userId, problem: null });
    const run = (async () => {
      const db = await getOfflineDatabase();
      void requestPersistentStorage();
      // Another user may have signed in while the database opened.
      if (this.state.userId !== userId) return null;
      const client = createClient();
      // lib/photos' createSupabaseUploadQueue, with every request checked against this user (ownToken).
      const queue = createUploadQueue({
        userId,
        items: db.store("uploads"),
        blobs: db.store("upload-blobs"),
        persistent: db.persistent,
        storage: supabaseStorage({
          url: env.url,
          apiKey: env.publishableKey,
          getAccessToken: () => ownToken(client, userId),
        }),
        repository: ownRepository(client, userId),
      });
      this.queue = queue;
      this.stopListening = queue.subscribe(() => this.onQueueChange(queue));
      this.onQueueChange(queue);
      this.setState({ phase: "ready" });
      void queue.start().catch((error: unknown) => console.error("Photo upload queue: start failed", error));
      return queue;
    })().catch((error: unknown) => {
      console.error("Photo upload queue: could not open the local store", error);
      if (this.state.userId === userId) this.setState({ phase: "unavailable", problem: QUEUE_PROBLEMS.failedToStart });
      return null;
    });
    this.starting = run;
    return run;
  }

  /**
   * Starts the queue for whoever is signed in, when no screen named the
   * user (no PhotoQueueProvider). Needs the session, so prefer the provider:
   * it also works offline with a session due for refresh.
   */
  startFromSession(): void {
    if (typeof window === "undefined" || this.state.phase !== "idle" || this.starting) return;
    this.setState({ phase: "starting" });
    const lookup = {};
    this.sessionLookup = lookup;
    this.starting = (async () => {
      let userId: string | undefined;
      try {
        const { data } = await createClient().auth.getSession();
        userId = data.session?.user.id;
      } catch (error) {
        console.error("Photo upload queue: could not read the session", error);
      }
      // A provider named the user meanwhile: its queue is the one.
      if (this.sessionLookup !== lookup) return this.whenStarted();
      this.sessionLookup = null;
      if (!userId) {
        this.setState({ phase: "unavailable", problem: QUEUE_PROBLEMS.signedOut });
        return null;
      }
      this.starting = null;
      return this.start(userId);
    })();
  }

  /** The queue once it exists; null when it cannot run. Starts it from the session if nothing has. */
  async whenStarted(): Promise<UploadQueue | null> {
    if (this.queue) return this.queue;
    if (!this.starting) this.startFromSession();
    return (await this.starting) ?? this.queue;
  }

  /**
   * Stops uploading, e.g. when the user signs out. What is queued stays on
   * this device and resumes when its user next opens a photo screen here.
   */
  stop(): void {
    if (typeof window === "undefined") return;
    this.sessionLookup = null;
    this.stopCurrent();
  }

  /** Processes and queues photos, one at a time. Returns at once: capture never waits. */
  addPhotos({ inspectionId, files, tag }: AddPhotosInput): void {
    if (typeof window === "undefined" || files.length === 0) return;
    const slot = moduleSlotKey(inspectionId, tag.moduleKey);
    this.bumpPreparing(inspectionId, slot, "photos", files.length);
    for (const file of files) {
      this.chain = this.chain.then(() => this.queuePhoto(inspectionId, slot, file, tag)).catch(() => undefined);
    }
  }

  /** Checks and queues lab reports and certificates. Returns at once. */
  addFiles({ inspectionId, moduleKey, kind, files, onQueued }: AddFilesInput): void {
    if (typeof window === "undefined" || files.length === 0) return;
    const slot = moduleSlotKey(inspectionId, moduleKey);
    this.bumpPreparing(inspectionId, slot, "files", files.length);
    for (const file of files) {
      this.chain = this.chain
        .then(() => this.queueFile(inspectionId, slot, moduleKey, kind, file, onQueued))
        .catch(() => undefined);
    }
  }

  async retag(id: string, change: { tag?: PhotoTag; caption?: string | null }): Promise<boolean> {
    return this.queue ? this.queue.retag(id, change) : false;
  }

  /**
   * Takes an item out of the queue. True: gone, objects included. False: it
   * had already left the queue or its row exists; delete it as an uploaded
   * photo or file.
   */
  async remove(id: string): Promise<boolean> {
    if (!this.queue) return false;
    this.removedHere.add(id);
    const removed = await this.queue.remove(id);
    if (removed) this.forgetPreview(id);
    return removed;
  }

  retryNow(id?: string): void {
    this.queue?.retryNow(id);
  }

  dismissRetagFailure(id: string): void {
    this.queue?.dismissRetagFailure(id);
  }

  /** Loads the local preview of a queued photo this page did not add (one kept from an earlier page). */
  loadPreview(id: string): void {
    const queue = this.queue;
    if (!queue || id in this.state.previews || this.previewLoads.has(id)) return;
    this.previewLoads.add(id);
    void queue
      .preview(id)
      .then((blob) => {
        if (id in this.state.previews) return;
        this.setPreview(id, blob ? URL.createObjectURL(blob) : null);
      })
      .catch(() => this.setPreview(id, null))
      .finally(() => this.previewLoads.delete(id));
  }

  /** Forgets a photo's local preview once it is deleted. */
  forgetPreview(id: string): void {
    if (!(id in this.state.previews)) return;
    const url = this.state.previews[id];
    if (url) URL.revokeObjectURL(url);
    const previews = { ...this.state.previews };
    delete previews[id];
    this.setState({ previews });
  }

  /** Stops showing finished uploads as such: the media store holds their rows now, or they are gone. */
  forgetSettled(ids: Iterable<string>): void {
    let settled: Record<string, UploadItem> | null = null;
    for (const id of ids) {
      if (!(id in this.state.settled)) continue;
      settled ??= { ...this.state.settled };
      delete settled[id];
    }
    if (settled) this.setState({ settled });
  }

  /**
   * Shows a retag or caption the server took for a finished upload whose row
   * is not read yet. False when no such upload is shown.
   */
  patchSettled(change: SettledChange): boolean {
    const item = this.state.settled[change.id];
    if (!item) return false;
    const next = { ...item, moduleKey: change.moduleKey, target: change.target, caption: change.caption };
    this.setState({ settled: { ...this.state.settled, [change.id]: next } });
    return true;
  }

  /**
   * The submit check (BUILD_SPEC 8.1): nothing being prepared and nothing
   * kept on this device for the inspection, other tabs included. Without an
   * inspection id: nothing waiting at all (before signing out).
   */
  async isSettled(inspectionId?: string): Promise<boolean> {
    if (typeof window === "undefined") return true;
    const counts = inspectionId === undefined ? Object.values(this.state.preparing) : [this.state.preparing[inspectionId]];
    if (counts.some((count) => count && count.photos + count.files > 0)) return false;
    const queue = await this.whenStarted();
    if (!queue) return this.state.phase === "unavailable" && this.state.problem === QUEUE_PROBLEMS.notConfigured;
    return queue.isEmptyNow(inspectionId);
  }

  /* ---------------------------------------------------------------- */

  private async queuePhoto(inspectionId: string, slot: string, file: File, tag: PhotoTag): Promise<void> {
    const name = file.name || "The photo";
    try {
      const queue = await this.whenStarted();
      if (!queue) {
        toast.error(`${name} was not added`, { description: this.state.problem ?? QUEUE_PROBLEMS.failedToStart });
        return;
      }
      const result = await processPhoto(file, { codec: browserCodec() });
      if (!result.ok) {
        toast.error(`${name} was not added`, { description: result.message });
        return;
      }
      const { photo } = result;
      const preview = photo.thumbBlob ?? (SHOWABLE_TYPES.has(photo.mimeType) ? photo.blob : null);
      const url = preview ? URL.createObjectURL(preview) : null;
      try {
        const id = await queue.enqueuePhoto({ inspectionId, photo, tag });
        this.setPreview(id, url, { replace: true });
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        throw error;
      }
    } catch (error) {
      console.error("Photo upload queue: a photo could not be queued", error);
      toast.error(`${name} was not added`, { description: "This device could not keep it. Try again." });
    } finally {
      this.bumpPreparing(inspectionId, slot, "photos", -1);
    }
  }

  private async queueFile(
    inspectionId: string,
    slot: string,
    moduleKey: string | null,
    kind: InspectionFileKind,
    file: File,
    onQueued: AddFilesInput["onQueued"],
  ): Promise<void> {
    const name = file.name || "The file";
    try {
      const queue = await this.whenStarted();
      if (!queue) {
        toast.error(`${name} was not added`, { description: this.state.problem ?? QUEUE_PROBLEMS.failedToStart });
        return;
      }
      const prepared = await prepareFile(file);
      if (!prepared.ok) {
        toast.error(`${name} was not added`, { description: prepared.message });
        return;
      }
      const id = await queue.enqueueFile({ inspectionId, file: prepared.file, moduleKey, kind });
      onQueued?.({ id, name: prepared.file.name });
    } catch (error) {
      console.error("Photo upload queue: a file could not be queued", error);
      toast.error(`${name} was not added`, { description: "This device could not keep it. Try again." });
    } finally {
      this.bumpPreparing(inspectionId, slot, "files", -1);
    }
  }

  private onQueueChange(queue: UploadQueue): void {
    if (queue !== this.queue) return;
    const snapshot = queue.getSnapshot();
    const current = new Map(snapshot.items.map((item) => [item.id, item] as const));
    const settled: UploadItem[] = [];
    for (const [id, item] of this.lastItems) {
      if (current.has(id)) continue;
      if (this.removedHere.delete(id)) continue;
      settled.push(item);
    }
    this.lastItems = current;
    if (settled.length === 0) {
      this.setState({ queue: snapshot });
      return;
    }
    // In the same update as the queue that no longer has them: a finished photo is never in neither list.
    const kept = { ...this.state.settled };
    for (const item of settled) kept[item.id] = item;
    this.setState({ queue: snapshot, settled: kept });
    for (const listener of [...this.settledListeners]) listener(settled);
  }

  private bumpPreparing(inspectionId: string, slot: string, kind: keyof PreparingCount, by: number): void {
    this.setState({
      preparing: bumpPreparing(this.state.preparing, inspectionId, kind, by),
      preparingByModule: bumpPreparing(this.state.preparingByModule, slot, kind, by),
    });
  }

  private setPreview(id: string, url: string | null, { replace = false }: { replace?: boolean } = {}): void {
    const existing = this.state.previews[id];
    if (id in this.state.previews && !replace) {
      if (url && url !== existing) URL.revokeObjectURL(url);
      return;
    }
    if (existing && existing !== url) URL.revokeObjectURL(existing);
    this.setState({ previews: { ...this.state.previews, [id]: url } });
  }

  private stopCurrent(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.queue?.stop();
    this.queue = null;
    this.starting = null;
    this.lastItems = new Map();
    this.removedHere.clear();
    this.setState({
      ...INITIAL_QUEUE_STATE,
      preparing: this.state.preparing,
      preparingByModule: this.state.preparingByModule,
    });
  }

  private setState(patch: Partial<PhotoQueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

/* ------------------------------------------------------------------ *
 * Whose session uploads
 * ------------------------------------------------------------------ */

type Client = SupabaseClient<Database>;

/**
 * The access token of the queue's own user: null when signed out, and also
 * when someone else is signed in on this browser now. A shared iPad must
 * never upload one inspector's photos under another's name; they wait (as
 * "sign in again") until their own user is back. Throws when an offline
 * device cannot refresh a token that is due, which the queue counts as no
 * connection (lib/photos sessionToken, with the user checked).
 */
export async function ownToken(client: Client, userId: string): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (session?.access_token) return session.user.id === userId ? session.access_token : null;
  if (error && isAuthRetryableFetchError(error)) throw error;
  return null;
}

/** The photo and file tables, written only while the queue's own user is signed in. */
export function ownRepository(client: Client, userId: string, inner: MediaRepository = supabaseRepository(client)): MediaRepository {
  const refusal = async (): Promise<TransferOutcome | null> => {
    try {
      if (await ownToken(client, userId)) return null;
      return { ok: false, reason: "unauthorized", message: FAILURE_MESSAGES.unauthorized };
    } catch {
      return { ok: false, reason: "network", message: FAILURE_MESSAGES.network };
    }
  };
  return {
    insertPhoto: async (row) => (await refusal()) ?? inner.insertPhoto(row),
    updatePhoto: async (id, patch) => (await refusal()) ?? inner.updatePhoto(id, patch),
    insertFile: async (row) => (await refusal()) ?? inner.insertFile(row),
  };
}

/** The page's queue. Components use it through the hooks in ./hooks. */
export const photoQueueStore = new PhotoQueueStore();
