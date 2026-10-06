// The page's one upload queue (docs/OFFLINE.md, "What the capture screen
// wires"), shared by every photo slot, file slot and gallery in the tab. It
// lives for the life of the page, not of a screen: uploads carry on while
// the inspector moves between modules or back to the list.
//
// Capture never waits (BUILD_SPEC 8.1). A chosen photo is counted as being
// prepared at once, processed in the browser one at a time (memory), handed
// to the queue, and uploads in the background with retries. Everything here
// runs in the browser only; on the server the store stays in its first state.
import { toast } from "sonner";
import { getSupabasePublicEnv } from "@/lib/env";
import { getOfflineDatabase, requestPersistentStorage } from "@/lib/offline/db";
import { browserCodec } from "@/lib/photos/browser-codec";
import { prepareFile, type InspectionFileKind } from "@/lib/photos/files";
import { processPhoto } from "@/lib/photos/process";
import { createSupabaseUploadQueue } from "@/lib/photos/supabase-adapters";
import type { PhotoTag } from "@/lib/photos/target";
import type { UploadItem, UploadQueue, UploadQueueSnapshot } from "@/lib/photos/upload-queue";
import { createClient } from "@/lib/supabase/client";

export type QueuePhase =
  /** Not started: no photo screen has asked for it yet. */
  | "idle"
  /** Opening the local database and reading what this device kept. */
  | "starting"
  | "ready"
  /** No Supabase settings, or no signed-in user: nothing can be queued. */
  | "unavailable";

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

export interface PreparingCount {
  photos: number;
  files: number;
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

const INITIAL_STATE: PhotoQueueState = {
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

/** Types a browser shows as they are: an original kept unconverted can still be its own preview. */
const SHOWABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function moduleSlotKey(inspectionId: string, moduleKey: string | null): string {
  return `${inspectionId}:${moduleKey ?? ""}`;
}

/** Items the queue let go of without this page removing them: uploaded (here or in another tab). */
export type SettledListener = (items: readonly UploadItem[]) => void;

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

class PhotoQueueStore {
  private state: PhotoQueueState = INITIAL_STATE;
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

  readonly getServerSnapshot = (): PhotoQueueState => INITIAL_STATE;

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
      const queue = createSupabaseUploadQueue({ client: createClient(), env, userId, db });
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
    this.setState({ queue: snapshot });
    if (settled.length > 0) for (const listener of [...this.settledListeners]) listener(settled);
  }

  private bumpPreparing(inspectionId: string, slot: string, kind: keyof PreparingCount, by: number): void {
    this.setState({
      preparing: bump(this.state.preparing, inspectionId, kind, by),
      preparingByModule: bump(this.state.preparingByModule, slot, kind, by),
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
    this.setState({ ...INITIAL_STATE, preparing: this.state.preparing, preparingByModule: this.state.preparingByModule });
  }

  private setState(patch: Partial<PhotoQueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

function bump(
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

/** The page's queue. Components use it through the hooks in ./hooks. */
export const photoQueueStore = new PhotoQueueStore();
