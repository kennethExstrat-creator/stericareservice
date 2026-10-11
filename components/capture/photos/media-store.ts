// The uploaded photos and files of one inspection, as this page knows them:
// loaded once (or handed over by the gallery's server render), then kept up
// to date from the upload queue and the actions' answers, so a retag or a
// finished upload never needs a page reload. One store per inspection per
// page, shared by every slot that shows it. Client-side navigation keeps the
// page, so a screen that shows a store again loads it again in the
// background, and another user signing in on the page empties them all.
// Browser only.
import {
  loadFiles,
  loadInspectionMedia,
  loadPhotos,
  MEDIA_MESSAGES,
  signPaths,
  type InspectionMedia,
} from "@/lib/inspections/photos/queries";
import type { PhotoChange } from "@/lib/inspections/photos/messages";
import { photoObjectPaths, previewPath, type MediaPhoto } from "@/lib/inspections/photos/view";
import { backoffDelay, UPLOAD_BACKOFF, type Backoff } from "@/lib/offline/backoff";
import { FILE_BUCKET, PHOTO_BUCKET } from "@/lib/photos/paths";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { createClient } from "@/lib/supabase/client";
import { photoQueueStore } from "./queue-store";

export type MediaStatus = "idle" | "loading" | "ready" | "not_found" | "error";

export interface MediaState {
  status: MediaStatus;
  media: InspectionMedia | null;
  /** Why the last load failed, in words. */
  error: string | null;
}

export const IDLE_MEDIA: MediaState = { status: "idle", media: null, error: null };

/** Sign again this long before the URLs run out (they last an hour). */
const RESIGN_MARGIN_MS = 5 * 60 * 1000;
const URL_LIFETIME_MS = 60 * 60 * 1000;
/** A failed load is retried no sooner than this, and when the connection returns. */
const RETRY_AFTER_MS = 15_000;
/**
 * A copy older than this is loaded again, in the background, when a screen
 * shows it again: photos added on another device, an inspection reopened
 * meanwhile. Younger ones are the copy the gallery has just handed over.
 */
export const REFRESH_AFTER_MS = 5_000;
/** Links that could not be signed are signed again after a pause, growing to ten minutes. */
const RESIGN_RETRY: Backoff = { initialMs: 15_000, maxMs: 10 * 60 * 1000, factor: 2, jitter: 0.2 };

type MediaKind = UploadItem["kind"];
/** A finished upload whose row is not read yet. `asked` grows each time a read is asked for, so one asked meanwhile is not lost. */
type Unread = { kind: MediaKind; asked: number };

export class InspectionMediaStore {
  private state: MediaState = IDLE_MEDIA;
  private readonly listeners = new Set<() => void>();
  /** Bumped by reset(): answers to requests made before it are dropped. */
  private generation = 0;
  private loading: Promise<void> | null = null;
  private lastAttempt = 0;
  /** This device's clock: when the copy on screen was loaded or handed over. */
  private receivedAt = 0;
  /** This device's clock: when the oldest links on screen were signed (or arrived), to sign them again in time. */
  private signedLocallyAt = 0;
  /** Signing again that left links unsigned, in a row; 0 once every link is signed. */
  private resignAttempts = 0;
  /**
   * The server's clock: the newest server copy taken. Re-renders hand the
   * same copy over again, and a page restored on Back an older one: neither
   * replaces what this page has since.
   */
  private lastSeedAt = Number.NEGATIVE_INFINITY;
  private resignTimer: ReturnType<typeof setTimeout> | null = null;
  private stopOnline: (() => void) | null = null;

  private readonly unread = new Map<string, Unread>();
  private asked = 0;
  private reading: Promise<void> | null = null;
  private readAgain = false;
  private unreadAttempts = 0;
  private unreadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Photos and files deleted on this page: a read that raced the delete must not bring them back. */
  private readonly removed = new Set<string>();

  constructor(readonly inspectionId: string) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.watch();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.unwatch();
    };
  };

  readonly getSnapshot = (): MediaState => this.state;

  /**
   * Takes the server's copy (the gallery page) unless this page has taken
   * that copy, or a newer one, before. `silent` while React renders: call
   * notify() after.
   */
  seed(media: InspectionMedia, { silent = false }: { silent?: boolean } = {}): void {
    // The server's clock against the server's: links signed again here carry this device's time.
    if (media.signedAt <= this.lastSeedAt) return;
    this.lastSeedAt = media.signedAt;
    this.take(media, { silent });
  }

  /** Tells the subscribers to read the state again. */
  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Loads the media unless it is loaded or loading; a failed load is retried after a pause. */
  ensureLoaded(): void {
    if (this.state.status === "ready" || this.state.status === "not_found" || this.loading) return;
    if (this.state.status === "error" && Date.now() - this.lastAttempt < RETRY_AFTER_MS) return;
    void this.load();
  }

  /** Loads everything again. What is on screen stays meanwhile, and so do its links while they last. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const generation = this.generation;
    this.lastAttempt = Date.now();
    // Finished uploads known now: their rows are in what this load reads.
    const covered = new Map(this.unread);
    const before = this.state;
    // finally() runs after this.loading is set, even when the load fails at once.
    this.loading = this.loadOnce(generation, covered).finally(() => {
      if (generation !== this.generation) return;
      this.loading = null;
      this.scheduleResign();
    });
    // Loading, unless it has already answered (it can fail at once).
    if (this.state === before && before.status !== "ready") this.setState({ ...before, status: "loading" });
    return this.loading;
  }

  /**
   * Takes over what the upload queue just finished: reads their rows, with
   * signed URLs, and stops the queue showing its own copy once they are in.
   * A read that fails is tried again with backoff and when the connection
   * returns; until then the queue's copy stays on screen.
   */
  takeUploaded(items: readonly UploadItem[]): Promise<void> {
    for (const item of items) this.askToRead(item.id, item.kind);
    return this.readUnread();
  }

  /** Applies an action's answer (retag, caption, report choice). */
  applyPhoto(change: PhotoChange): void {
    const media = this.state.media;
    if (media?.photos.some((photo) => photo.id === change.id)) {
      const photos = media.photos.map((photo) =>
        photo.id === change.id
          ? {
              ...photo,
              moduleKey: change.moduleKey,
              target: change.target,
              caption: change.caption,
              includeInReport: change.includeInReport,
            }
          : photo,
      );
      this.setState({ ...this.state, media: { ...media, photos } });
      return;
    }
    // A finished upload whose row is not read yet: show the change now, and read the row (again) after it.
    if (photoQueueStore.patchSettled(change)) {
      this.askToRead(change.id, "photo");
      void this.readUnread();
    }
  }

  /**
   * A photo or file moved to another Media category (Source Documents): its
   * new module_key. A photo's old target goes, as moveMedia clears it.
   */
  applyModuleKey(kind: MediaKind, id: string, moduleKey: string | null): void {
    const media = this.state.media;
    if (media && kind === "photo" && media.photos.some((photo) => photo.id === id)) {
      const photos = media.photos.map((photo) => (photo.id === id ? { ...photo, moduleKey, target: null } : photo));
      this.setState({ ...this.state, media: { ...media, photos } });
      return;
    }
    if (media && kind === "file" && media.files.some((file) => file.id === id)) {
      const files = media.files.map((file) => (file.id === id ? { ...file, moduleKey } : file));
      this.setState({ ...this.state, media: { ...media, files } });
      return;
    }
    // A finished upload whose row is not read yet: read it (again), after the move.
    this.askToRead(id, kind);
    void this.readUnread();
  }

  removePhoto(id: string): void {
    this.forget(id);
    const media = this.state.media;
    if (!media || !media.photos.some((photo) => photo.id === id)) return;
    this.setState({ ...this.state, media: { ...media, photos: media.photos.filter((photo) => photo.id !== id) } });
  }

  removeFile(id: string): void {
    this.forget(id);
    const media = this.state.media;
    if (!media || !media.files.some((file) => file.id === id)) return;
    this.setState({ ...this.state, media: { ...media, files: media.files.filter((file) => file.id !== id) } });
  }

  /** Signs every URL again, before they run out (or soon after some could not be signed). */
  async resign(): Promise<void> {
    const media = this.state.media;
    if (!media) return;
    const generation = this.generation;
    const startedAt = Date.now();
    const client = createClient();
    const [photoUrls, fileUrls] = await Promise.all([
      signPaths(client, PHOTO_BUCKET, photoObjectPaths(media.photos.map(asRow))),
      signPaths(client, FILE_BUCKET, media.files.map((file) => file.storagePath)),
    ]);
    const current = this.state.media;
    if (generation !== this.generation || !current) return;
    const photos = current.photos.map((photo): MediaPhoto => {
      const preview = previewPath(asRow(photo));
      return {
        ...photo,
        thumbUrl: (preview && photoUrls.urls.get(preview)) || photo.thumbUrl,
        fullUrl: photoUrls.urls.get(photo.storagePath) ?? photo.fullUrl,
      };
    });
    const files = current.files.map((file) => ({ ...file, url: fileUrls.urls.get(file.storagePath) ?? file.url }));
    const complete = photoUrls.complete && fileUrls.complete;
    this.signedLocallyAt = startedAt;
    this.resignAttempts = complete ? 0 : this.resignAttempts + 1;
    const problems = complete ? current.problems.filter((problem) => problem !== MEDIA_MESSAGES.signFailed) : current.problems;
    this.setState({ ...this.state, media: { ...current, photos, files, problems, signedAt: startedAt } });
    this.scheduleResign();
  }

  /**
   * Forgets everything, when another user signs in on this page, and loads
   * again for the screens still showing it: never the earlier user's rights.
   */
  reset(): void {
    this.generation++;
    this.loading = null;
    this.reading = null;
    this.readAgain = false;
    this.cancelUnreadRetry();
    this.unread.clear();
    this.unreadAttempts = 0;
    this.removed.clear();
    this.lastAttempt = 0;
    this.receivedAt = 0;
    this.signedLocallyAt = 0;
    this.resignAttempts = 0;
    if (this.resignTimer !== null) clearTimeout(this.resignTimer);
    this.resignTimer = null;
    this.setState(IDLE_MEDIA);
    if (this.listeners.size > 0) void this.load();
  }

  /* ---------------------------------------------------------------- */

  private async loadOnce(generation: number, covered: ReadonlyMap<string, Unread>): Promise<void> {
    try {
      const result = await loadInspectionMedia(createClient(), this.inspectionId);
      if (generation !== this.generation) return;
      if (result.kind === "ok") {
        this.take(result.media, { keepLinks: true });
        this.markRead(covered);
      } else if (result.kind === "not_found") {
        this.receivedAt = Date.now();
        this.setState({ status: "not_found", media: null, error: null });
        this.markRead(covered);
      } else if (!this.state.media) {
        this.setState({ status: "error", media: null, error: result.message });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      console.error("Inspection photos: load failed", error);
      if (!this.state.media) {
        this.setState({ status: "error", media: null, error: "The photos could not be loaded. Check the connection." });
      }
    }
  }

  /** Puts a copy on screen; one loaded again keeps the links already shown while they last, so no thumbnail loads twice. */
  private take(media: InspectionMedia, { silent = false, keepLinks = false }: { silent?: boolean; keepLinks?: boolean } = {}): void {
    const now = Date.now();
    const previous = this.state.media;
    const reuse = keepLinks && previous !== null && now - this.signedLocallyAt < URL_LIFETIME_MS / 2;
    const next = withoutRemoved(reuse ? keepShownLinks(media, previous) : media, this.removed);
    // Reused links keep their age: the oldest link on screen decides when to sign again.
    if (!reuse) this.signedLocallyAt = now;
    this.receivedAt = now;
    this.resignAttempts = next.problems.includes(MEDIA_MESSAGES.signFailed) ? Math.max(1, this.resignAttempts) : 0;
    const state: MediaState = { status: "ready", media: next, error: null };
    if (silent) {
      this.state = state;
      return;
    }
    this.setState(state);
    this.scheduleResign();
  }

  private askToRead(id: string, kind: MediaKind): void {
    this.unread.set(id, { kind, asked: ++this.asked });
  }

  /** Reads the rows of finished uploads, one read at a time; one asked for meanwhile follows straight after. */
  private readUnread(): Promise<void> {
    if (this.reading) {
      this.readAgain = true;
      return this.reading;
    }
    const generation = this.generation;
    this.reading = (async () => {
      do {
        this.readAgain = false;
        try {
          await this.readUnreadOnce(generation);
        } catch (error) {
          console.error("Inspection photos: reading new uploads failed", error);
          if (generation === this.generation) this.retryUnread();
        }
      } while (generation === this.generation && this.readAgain && this.unread.size > 0);
    })().finally(() => {
      if (generation === this.generation) this.reading = null;
    });
    return this.reading;
  }

  private async readUnreadOnce(generation: number): Promise<void> {
    this.cancelUnreadRetry();
    // A load running now may have read the rows just before these went in.
    if (this.loading) await this.loading;
    if (generation !== this.generation || this.unread.size === 0) return;
    if (this.state.status === "not_found") {
      // This user cannot read the inspection here: nothing of it is shown.
      this.markRead(new Map(this.unread));
      return;
    }
    if (!this.state.media) {
      // Nothing loaded yet (the page opened offline): a full load brings these rows with the rest.
      await this.load();
      if (generation === this.generation && !this.state.media) this.retryUnread();
      return;
    }

    const batch = new Map(this.unread);
    const idsOf = (kind: MediaKind) => [...batch].filter(([, entry]) => entry.kind === kind).map(([id]) => id);
    const client = createClient();
    const [photos, files] = await Promise.all([loadPhotos(client, idsOf("photo")), loadFiles(client, idsOf("file"))]);
    const media = this.state.media;
    if (generation !== this.generation || !media) return;
    const next = withoutRemoved(
      {
        ...media,
        photos: photos.ok ? upsertById(media.photos, photos.photos) : media.photos,
        files: files.ok ? upsertById(media.files, files.files) : media.files,
      },
      this.removed,
    );
    if (next.photos !== media.photos || next.files !== media.files) this.setState({ ...this.state, media: next });

    // Read, found or not (a missing row was deleted meanwhile): the queue's copy can go.
    this.markRead(new Map([...batch].filter(([, entry]) => (entry.kind === "photo" ? photos.ok : files.ok))));
    if (photos.ok && files.ok) this.unreadAttempts = 0;
    else this.retryUnread();
    if ((photos.ok && !photos.complete) || (files.ok && !files.complete)) {
      this.resignAttempts = Math.max(1, this.resignAttempts);
      this.scheduleResign();
    }
  }

  /** Rows read: stop showing the queue's copies, unless a read was asked again meanwhile (a retag). */
  private markRead(batch: ReadonlyMap<string, Unread>): void {
    const done: string[] = [];
    for (const [id, entry] of batch) {
      if (this.unread.get(id)?.asked !== entry.asked) continue;
      this.unread.delete(id);
      done.push(id);
    }
    if (done.length > 0) photoQueueStore.forgetSettled(done);
  }

  private retryUnread(): void {
    if (this.unreadTimer !== null || this.unread.size === 0) return;
    this.unreadAttempts++;
    this.unreadTimer = setTimeout(() => {
      this.unreadTimer = null;
      void this.readUnread();
    }, backoffDelay(this.unreadAttempts, UPLOAD_BACKOFF));
  }

  private cancelUnreadRetry(): void {
    if (this.unreadTimer !== null) clearTimeout(this.unreadTimer);
    this.unreadTimer = null;
  }

  /** A photo or file deleted on this page: never shown again, from a read or from the queue's copy. */
  private forget(id: string): void {
    this.removed.add(id);
    this.unread.delete(id);
    photoQueueStore.forgetSettled([id]);
  }

  private watch(): void {
    if (typeof window !== "undefined") {
      const online = () => {
        if (this.state.status === "error") {
          this.lastAttempt = 0;
          this.ensureLoaded();
        }
        if (this.unread.size > 0) void this.readUnread();
        if (this.resignAttempts > 0 && this.state.media) {
          void this.resign().catch((error: unknown) => console.error("Inspection photos: signing again failed", error));
        }
      };
      window.addEventListener("online", online);
      this.stopOnline = () => window.removeEventListener("online", online);
    }
    // Shown again after a while: client-side navigation kept this copy, so load it again behind what is on screen.
    const settledState = this.state.status === "ready" || this.state.status === "not_found";
    if (settledState && Date.now() - this.receivedAt > REFRESH_AFTER_MS) void this.load();
    this.scheduleResign();
  }

  private unwatch(): void {
    this.stopOnline?.();
    this.stopOnline = null;
    if (this.resignTimer !== null) clearTimeout(this.resignTimer);
    this.resignTimer = null;
  }

  private scheduleResign(): void {
    if (this.resignTimer !== null) clearTimeout(this.resignTimer);
    this.resignTimer = null;
    if (!this.state.media || this.listeners.size === 0 || typeof window === "undefined") return;
    const due =
      this.resignAttempts > 0
        ? backoffDelay(this.resignAttempts, RESIGN_RETRY)
        : this.signedLocallyAt + URL_LIFETIME_MS - RESIGN_MARGIN_MS - Date.now();
    this.resignTimer = setTimeout(
      () => {
        this.resignTimer = null;
        void this.resign().catch((error: unknown) => {
          console.error("Inspection photos: signing again failed", error);
          this.resignAttempts++;
          this.scheduleResign();
        });
      },
      Math.max(5_000, due),
    );
  }

  private setState(next: MediaState): void {
    this.state = next;
    this.notify();
  }
}

function asRow(photo: MediaPhoto) {
  return { storage_path: photo.storagePath, thumb_path: photo.thumbPath };
}

function upsertById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return current as T[];
  const byId = new Map(incoming.map((item) => [item.id, item] as const));
  const merged = current.map((item) => byId.get(item.id) ?? item);
  for (const item of incoming) if (!current.some((existing) => existing.id === item.id)) merged.push(item);
  return merged;
}

function withoutRemoved(media: InspectionMedia, removed: ReadonlySet<string>): InspectionMedia {
  if (removed.size === 0) return media;
  const photos = media.photos.some((photo) => removed.has(photo.id)) ? media.photos.filter((photo) => !removed.has(photo.id)) : media.photos;
  const files = media.files.some((file) => removed.has(file.id)) ? media.files.filter((file) => !removed.has(file.id)) : media.files;
  return photos === media.photos && files === media.files ? media : { ...media, photos, files };
}

/** The links of a copy loaded again, where the same objects are already on screen with links. */
function keepShownLinks(media: InspectionMedia, shown: InspectionMedia): InspectionMedia {
  const photos = new Map(shown.photos.map((photo) => [photo.id, photo] as const));
  const files = new Map(shown.files.map((file) => [file.id, file] as const));
  return {
    ...media,
    photos: media.photos.map((photo) => {
      const old = photos.get(photo.id);
      if (!old || old.storagePath !== photo.storagePath || old.thumbPath !== photo.thumbPath) return photo;
      return { ...photo, thumbUrl: old.thumbUrl ?? photo.thumbUrl, fullUrl: old.fullUrl ?? photo.fullUrl };
    }),
    files: media.files.map((file) => {
      const old = files.get(file.id);
      return old && old.storagePath === file.storagePath ? { ...file, url: old.url ?? file.url } : file;
    }),
  };
}

const stores = new Map<string, InspectionMediaStore>();
let wired = false;
/** The user the stores were loaded for. Signing out keeps them (the page is leaving); another user empties them. */
let owner: string | null = null;

function wire(): void {
  if (wired) return;
  wired = true;
  owner = photoQueueStore.getSnapshot().userId;
  photoQueueStore.onSettled((items) => {
    const byInspection = new Map<string, UploadItem[]>();
    for (const item of items) byInspection.set(item.inspectionId, [...(byInspection.get(item.inspectionId) ?? []), item]);
    for (const [id, settled] of byInspection) {
      const store = stores.get(id);
      if (!store) {
        // Nothing on this page shows that inspection; a store made later loads the rows with the rest.
        photoQueueStore.forgetSettled(settled.map((item) => item.id));
        continue;
      }
      void store.takeUploaded(settled).catch((error: unknown) => console.error("Inspection photos: reading new uploads failed", error));
    }
  });
  photoQueueStore.subscribe(() => {
    const { userId } = photoQueueStore.getSnapshot();
    if (userId === null || userId === owner) return;
    const previous = owner;
    owner = userId;
    if (previous !== null) for (const store of stores.values()) store.reset();
  });
}

/**
 * The page's store for one inspection (browser only). Finished uploads flow
 * into it from the queue.
 */
export function mediaStore(inspectionId: string): InspectionMediaStore {
  wire();
  let store = stores.get(inspectionId);
  if (!store) {
    store = new InspectionMediaStore(inspectionId);
    stores.set(inspectionId, store);
  }
  return store;
}
