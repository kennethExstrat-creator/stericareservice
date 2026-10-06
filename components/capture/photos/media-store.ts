// The uploaded photos and files of one inspection, as this page knows them:
// loaded once (or handed over by the gallery's server render), then kept up
// to date from the upload queue and the actions' answers, so a retag or a
// finished upload never needs a page reload. One store per inspection per
// page, shared by every slot that shows it. Browser only.
import { loadFiles, loadInspectionMedia, loadPhotos, signPaths, type InspectionMedia } from "@/lib/inspections/photos/queries";
import { photoObjectPaths, previewPath, type MediaPhoto } from "@/lib/inspections/photos/view";
import type { PhotoChange } from "@/lib/inspections/photos/messages";
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

export class InspectionMediaStore {
  private state: MediaState = IDLE_MEDIA;
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private lastAttempt = 0;
  private resignTimer: ReturnType<typeof setTimeout> | null = null;
  private stopOnline: (() => void) | null = null;

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
   * Takes the server's copy (the gallery page), unless this page already
   * holds a newer one. `silent` while React renders: call notify() after.
   */
  seed(media: InspectionMedia, { silent = false }: { silent?: boolean } = {}): void {
    if (this.state.media && this.state.media.signedAt >= media.signedAt) return;
    const next: MediaState = { status: "ready", media, error: null };
    if (silent) this.state = next;
    else this.setState(next);
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

  async load(): Promise<void> {
    if (this.loading) return this.loading;
    this.lastAttempt = Date.now();
    if (this.state.status !== "ready") this.setState({ ...this.state, status: "loading" });
    this.loading = (async () => {
      try {
        const result = await loadInspectionMedia(createClient(), this.inspectionId);
        if (result.kind === "ok") this.setState({ status: "ready", media: result.media, error: null });
        else if (result.kind === "not_found") this.setState({ status: "not_found", media: null, error: null });
        else if (!this.state.media) this.setState({ status: "error", media: null, error: result.message });
      } catch (error) {
        console.error("Inspection photos: load failed", error);
        if (!this.state.media) {
          this.setState({ status: "error", media: null, error: "The photos could not be loaded. Check the connection." });
        }
      } finally {
        this.loading = null;
        this.scheduleResign();
      }
    })();
    return this.loading;
  }

  /** Adds what the upload queue just finished: rows by id, with signed URLs. */
  async takeUploaded(items: readonly UploadItem[]): Promise<void> {
    // A load running now may have read the rows just before these went in.
    if (this.loading) await this.loading;
    if (!this.state.media) {
      // Nothing loaded yet (the page opened offline): a full load brings these rows with the rest.
      this.lastAttempt = 0;
      this.ensureLoaded();
      return;
    }
    const photoIds = items.filter((item) => item.kind === "photo").map((item) => item.id);
    const fileIds = items.filter((item) => item.kind === "file").map((item) => item.id);
    const client = createClient();
    const [photos, files] = await Promise.all([loadPhotos(client, photoIds), loadFiles(client, fileIds)]);
    const media = this.state.media;
    if (!media) return;
    const next = { ...media };
    if (photos.ok && photos.photos.length > 0) next.photos = upsertById(media.photos, photos.photos);
    if (files.ok && files.files.length > 0) next.files = upsertById(media.files, files.files);
    if (next.photos !== media.photos || next.files !== media.files) this.setState({ ...this.state, media: next });
    // A row that could not be read yet (a slow connection) arrives with the next full load.
    if (!photos.ok || !files.ok) this.lastAttempt = 0;
  }

  /** Applies an action's answer (retag, caption, report choice). */
  applyPhoto(change: PhotoChange): void {
    const media = this.state.media;
    if (!media) return;
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
  }

  removePhoto(id: string): void {
    const media = this.state.media;
    if (!media || !media.photos.some((photo) => photo.id === id)) return;
    this.setState({ ...this.state, media: { ...media, photos: media.photos.filter((photo) => photo.id !== id) } });
  }

  removeFile(id: string): void {
    const media = this.state.media;
    if (!media || !media.files.some((file) => file.id === id)) return;
    this.setState({ ...this.state, media: { ...media, files: media.files.filter((file) => file.id !== id) } });
  }

  /** Signs every URL again, before they run out. */
  async resign(): Promise<void> {
    const media = this.state.media;
    if (!media) return;
    const client = createClient();
    const [photoUrls, fileUrls] = await Promise.all([
      signPaths(client, PHOTO_BUCKET, photoObjectPaths(media.photos.map(asRow))),
      signPaths(client, FILE_BUCKET, media.files.map((file) => file.storagePath)),
    ]);
    const current = this.state.media;
    if (!current) return;
    const photos = current.photos.map((photo): MediaPhoto => {
      const preview = previewPath(asRow(photo));
      return {
        ...photo,
        thumbUrl: (preview && photoUrls.urls.get(preview)) || photo.thumbUrl,
        fullUrl: photoUrls.urls.get(photo.storagePath) ?? photo.fullUrl,
      };
    });
    const files = current.files.map((file) => ({ ...file, url: fileUrls.urls.get(file.storagePath) ?? file.url }));
    this.setState({ ...this.state, media: { ...current, photos, files, signedAt: Date.now() } });
    this.scheduleResign();
  }

  private watch(): void {
    if (typeof window === "undefined") return;
    const online = () => {
      if (this.state.status === "error") {
        this.lastAttempt = 0;
        this.ensureLoaded();
      }
    };
    window.addEventListener("online", online);
    this.stopOnline = () => window.removeEventListener("online", online);
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
    const media = this.state.media;
    if (!media || this.listeners.size === 0 || typeof window === "undefined") return;
    const due = media.signedAt + URL_LIFETIME_MS - RESIGN_MARGIN_MS - Date.now();
    this.resignTimer = setTimeout(
      () => {
        this.resignTimer = null;
        void this.resign().catch((error: unknown) => console.error("Inspection photos: signing again failed", error));
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
  const byId = new Map(incoming.map((item) => [item.id, item] as const));
  const merged = current.map((item) => byId.get(item.id) ?? item);
  for (const item of incoming) if (!current.some((existing) => existing.id === item.id)) merged.push(item);
  return merged;
}

const stores = new Map<string, InspectionMediaStore>();
let listeningToQueue = false;

/**
 * The page's store for one inspection (browser only). Finished uploads flow
 * into it from the queue.
 */
export function mediaStore(inspectionId: string): InspectionMediaStore {
  let store = stores.get(inspectionId);
  if (!store) {
    store = new InspectionMediaStore(inspectionId);
    stores.set(inspectionId, store);
  }
  if (!listeningToQueue) {
    listeningToQueue = true;
    photoQueueStore.onSettled((items) => {
      const byInspection = new Map<string, UploadItem[]>();
      for (const item of items) byInspection.set(item.inspectionId, [...(byInspection.get(item.inspectionId) ?? []), item]);
      for (const [id, settled] of byInspection) {
        void stores
          .get(id)
          ?.takeUploaded(settled)
          .catch((error: unknown) => console.error("Inspection photos: reading new uploads failed", error));
      }
    });
  }
  return store;
}
