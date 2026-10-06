import { z } from "zod";
import { UPLOAD_BACKOFF, backoffDelay, type Backoff } from "@/lib/offline/backoff";
import { defaultConnectivity, type Connectivity } from "@/lib/offline/connectivity";
import { FAILURE_REASONS, isRetryable, thrownFailure, type Failure } from "@/lib/offline/failures";
import { UUID_PATTERN, newId } from "@/lib/offline/id";
import type { KeyValueStore } from "@/lib/offline/kv";
import { Constants, type TablesInsert } from "@/lib/supabase/database.types";
import type { InspectionFileKind, PreparedFile } from "./files";
import { FILE_BUCKET, PHOTO_BUCKET, extensionFor, filePath, photoPath, thumbPath, type MediaBucket } from "./paths";
import type { ProcessedPhoto } from "./process";
import { buildTarget, type PhotoTag } from "./target";

/* ------------------------------------------------------------------ *
 * Background upload queue (BUILD_SPEC 8.1, docs/OFFLINE.md).
 *
 * Capture never waits: an item is written to IndexedDB and the call
 * returns. Items upload one at a time, in order: the object (and a photo's
 * thumbnail) to Storage, then the row. Each step is recorded, retried with
 * backoff, and idempotent, because the object name and the row id are the
 * item's id: a retry finds its earlier work instead of duplicating it.
 * ------------------------------------------------------------------ */

export type TransferOutcome = { ok: true } | ({ ok: false } & Failure);

export interface UploadRequest {
  bucket: MediaBucket;
  /** Object name inside the bucket. */
  path: string;
  body: Blob;
  contentType: string;
  signal: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

/** Supabase Storage in the app (supabase-adapters.ts), a fake in tests. */
export interface UploadStorage {
  /**
   * Must count an object already at `path` as success (an earlier attempt
   * whose answer was lost), and must not overwrite it.
   */
  upload(request: UploadRequest): Promise<TransferOutcome>;
  /** Best effort, for items removed after their object went up but before their row. */
  remove?(bucket: MediaBucket, paths: string[]): Promise<TransferOutcome>;
}

export type PhotoRow = Required<
  Pick<
    TablesInsert<"inspection_photos">,
    | "id"
    | "inspection_id"
    | "module_key"
    | "target"
    | "storage_path"
    | "thumb_path"
    | "caption"
    | "taken_at"
    | "width"
    | "height"
    | "flagged"
  >
>;
export type PhotoRowPatch = Pick<PhotoRow, "module_key" | "target" | "caption">;
export type FileRow = Required<
  Pick<TablesInsert<"inspection_files">, "id" | "inspection_id" | "module_key" | "kind" | "storage_path" | "name">
>;

/** The inspection_photos and inspection_files tables in the app, a fake in tests. */
export interface MediaRepository {
  /** Must count a row that already has this id as success (an earlier attempt whose answer was lost). */
  insertPhoto(row: PhotoRow): Promise<TransferOutcome>;
  updatePhoto(id: string, patch: PhotoRowPatch): Promise<TransferOutcome>;
  /** Must count a row that already has this id as success. */
  insertFile(row: FileRow): Promise<TransferOutcome>;
}

/**
 * Runs `run` under a lock shared by the browser's tabs, or reports that
 * another tab holds it. browserLock() uses navigator.locks.
 */
export type ItemLock = <T>(name: string, run: () => Promise<T>) => Promise<{ acquired: true; value: T } | { acquired: false }>;

/* ------------------------------------------------------------------ *
 * Stored items
 * ------------------------------------------------------------------ */

const Uuid = z.string().regex(UUID_PATTERN);
const FailureSchema = z.object({ reason: z.enum(FAILURE_REASONS), message: z.string() });

const ItemFields = {
  /** Record format; bump with a migration when the shape changes. */
  v: z.literal(1),
  /** Also the row id and the object name. */
  id: Uuid,
  userId: z.string().min(1),
  inspectionId: Uuid,
  /** Upload order. */
  seq: z.number().int().nonnegative(),
  createdAt: z.number(),
  moduleKey: z.string().min(1).nullable(),
  mimeType: z.string().min(1),
  extension: z.string().min(1),
  /** Bytes of the object. */
  size: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  error: FailureSchema.nullable(),
  /** Stopped on a failure that needs a person; retryNow() puts it back in line. */
  failed: z.boolean(),
};

const PhotoItemSchema = z.object({
  ...ItemFields,
  kind: z.literal("photo"),
  target: z.string().nullable(),
  caption: z.string().nullable(),
  takenAt: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  flagged: z.boolean(),
  /** Null: no thumbnail (a flagged original). */
  thumbSize: z.number().int().nonnegative().nullable(),
  done: z.object({ object: z.boolean(), thumb: z.boolean(), row: z.boolean() }),
  /** Counts retags; rowMeta is the count the row reflects. */
  meta: z.number().int().nonnegative(),
  rowMeta: z.number().int().nonnegative(),
});

const FileItemSchema = z.object({
  ...ItemFields,
  kind: z.literal("file"),
  fileKind: z.enum(Constants.public.Enums.inspection_file_kind),
  name: z.string().min(1),
  done: z.object({ object: z.boolean(), row: z.boolean() }),
});

export const QueuedItemSchema = z.discriminatedUnion("kind", [PhotoItemSchema, FileItemSchema]);
type QueuedItem = z.infer<typeof QueuedItemSchema>;
type PhotoItem = z.infer<typeof PhotoItemSchema>;
type FileItem = z.infer<typeof FileItemSchema>;

/** Bytes are stored as ArrayBuffer, which every engine's IndexedDB round-trips. */
const StoredBytesSchema = z.object({ type: z.string(), bytes: z.instanceof(ArrayBuffer), storedAt: z.number() });

type Part = "object" | "thumb";
const blobKey = (id: string, part: Part) => `${id}/${part}`;

/** Bytes whose item was never written (an enqueue cut short) are collected after this long. */
const ORPHAN_AGE_MS = 60 * 60 * 1000;
const LOCK_PREFIX = "stericare-upload:";

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export type UploadState = "waiting" | "uploading" | "failed";

export interface UploadItem {
  /** The future inspection_photos.id or inspection_files.id. */
  id: string;
  kind: "photo" | "file";
  inspectionId: string;
  moduleKey: string | null;
  /** Photos: the target string. */
  target: string | null;
  caption: string | null;
  /** Files: the name shown in lists. */
  name: string | null;
  /** A photo kept as the original because the browser could not convert it. */
  flagged: boolean;
  takenAt: string | null;
  state: UploadState;
  /** 0 to 1. */
  progress: number;
  error: Failure | null;
  createdAt: number;
}

export interface UploadQueueSnapshot {
  /** In upload order. */
  items: readonly UploadItem[];
  /** Everything not uploaded yet, failed items included: the badge. */
  pending: number;
  failed: number;
  online: boolean;
  /** Device time (ms) of the next automatic retry. */
  retryAt: number | null;
  /** The failure being waited out, e.g. an expired session ("Sign in again"). */
  error: Failure | null;
  /** False once an item could not be kept on this device: it uploads only while this page stays open. */
  localCopy: boolean;
}

export interface EnqueuePhoto {
  inspectionId: string;
  photo: ProcessedPhoto;
  tag: PhotoTag;
  caption?: string | null;
}

export interface EnqueueFile {
  inspectionId: string;
  file: PreparedFile;
  moduleKey: string | null;
  kind: InspectionFileKind;
}

export interface UploadQueueOptions {
  userId: string;
  /** The "uploads" store of the offline database. */
  items: KeyValueStore<unknown>;
  /** The "upload-blobs" store. */
  blobs: KeyValueStore<unknown>;
  storage: UploadStorage;
  repository: MediaRepository;
  connectivity?: Connectivity;
  backoff?: Backoff;
  lock?: ItemLock;
  now?: () => number;
  random?: () => number;
  newId?: () => string;
}

export interface UploadQueue {
  /** Loads this user's items that survived a reload and starts uploading. Call once. */
  start(): Promise<void>;
  /** Queues a processed photo; resolves with its id once it is kept on this device. */
  enqueuePhoto(input: EnqueuePhoto): Promise<string>;
  /** Queues a lab report or certificate; resolves with its id once it is kept on this device. */
  enqueueFile(input: EnqueueFile): Promise<string>;
  /** Retags or recaptions a queued photo. False once it has left the queue: update its row instead. */
  retag(id: string, change: { tag?: PhotoTag; caption?: string | null }): Promise<boolean>;
  /** Drops an item whose row is not written yet, with any object already uploaded. False once its row exists. */
  remove(id: string): Promise<boolean>;
  /** Puts failed items back in line (one, or all) and retries now instead of waiting out the backoff. */
  retryNow(id?: string): void;
  /** Items not uploaded yet, failed ones included. */
  pendingCount(inspectionId?: string): number;
  /** Submit waits for this (BUILD_SPEC 8.1). */
  isEmpty(inspectionId: string): boolean;
  /** The local thumbnail of a queued photo, for its tile. Null for files and unconvertible originals. */
  preview(id: string): Promise<Blob | null>;
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): UploadQueueSnapshot;
  /** Aborts the current transfer and stops; items stay queued for the next start. */
  stop(): void;
}

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  return new Queue(options);
}

/**
 * navigator.locks where the browser has it, so two tabs never upload the
 * same item at once. Without it every lock is granted, and the idempotent
 * steps keep a double upload harmless.
 */
export function browserLock(): ItemLock {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") {
    return async (_name, run) => ({ acquired: true, value: await run() });
  }
  return async <T>(name: string, run: () => Promise<T>) => {
    let outcome: { acquired: true; value: T } | { acquired: false } = { acquired: false };
    await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (lock) outcome = { acquired: true, value: await run() };
    });
    return outcome;
  };
}

/* ------------------------------------------------------------------ *
 * Implementation
 * ------------------------------------------------------------------ */

type TransferResult = "done" | "retry" | "failed" | "cancelled" | "gone" | "busy";

type BytesRead = { blob: Blob } | { missing: true } | { unreadable: true };

class Queue implements UploadQueue {
  private readonly userId: string;
  private readonly itemStore: KeyValueStore<unknown>;
  private readonly blobStore: KeyValueStore<unknown>;
  private readonly storage: UploadStorage;
  private readonly repository: MediaRepository;
  private readonly connectivity: Connectivity;
  private readonly backoff: Backoff;
  private readonly lock: ItemLock;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly makeId: () => string;

  private readonly queued = new Map<string, QueuedItem>();
  private readonly progress = new Map<string, number>();
  /** Bytes of items that could not be written locally: they upload from memory. */
  private readonly memoryBlobs = new Map<string, Blob>();
  /** Items another tab is uploading. */
  private readonly busyElsewhere = new Set<string>();
  private readonly removing = new Set<string>();
  private readonly enqueuing = new Set<string>();
  private readonly listeners = new Set<() => void>();

  private phase: "new" | "running" | "stopped" = "new";
  private pumping = false;
  private current: { id: string; abort: AbortController; done: Promise<unknown> } | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt: number | null = null;
  /** Looks again at items another tab held, without holding up the rest. */
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private lastError: Failure | null = null;
  private localCopy = true;
  private nextSeq = 0;
  private online: boolean;
  private unsubscribe: (() => void) | null = null;
  private snapshot: UploadQueueSnapshot;

  constructor(options: UploadQueueOptions) {
    this.userId = options.userId;
    this.itemStore = options.items;
    this.blobStore = options.blobs;
    this.storage = options.storage;
    this.repository = options.repository;
    this.connectivity = options.connectivity ?? defaultConnectivity();
    this.backoff = options.backoff ?? UPLOAD_BACKOFF;
    this.lock = options.lock ?? browserLock();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.makeId = options.newId ?? (() => newId());
    this.online = this.connectivity.isOnline();
    this.snapshot = this.computeSnapshot();
  }

  async start(): Promise<void> {
    if (this.phase !== "new") throw new Error("The upload queue has already been started.");
    let stored: unknown[] = [];
    try {
      stored = await this.itemStore.getAll();
    } catch {
      this.localCopy = false;
    }
    for (const raw of stored) {
      const parsed = QueuedItemSchema.safeParse(raw);
      // Another user's items wait for them; unreadable ones are left alone.
      if (!parsed.success || parsed.data.userId !== this.userId || this.queued.has(parsed.data.id)) continue;
      this.queued.set(parsed.data.id, parsed.data);
    }
    for (const item of this.queued.values()) this.nextSeq = Math.max(this.nextSeq, item.seq + 1);
    await this.collectOrphans().catch(() => undefined);
    if (this.phase !== "new") return;

    this.phase = "running";
    this.online = this.connectivity.isOnline();
    this.unsubscribe = this.connectivity.subscribe((online) => this.setOnline(online));
    this.emit();
    void this.pump();
  }

  async enqueuePhoto({ inspectionId, photo, tag, caption = null }: EnqueuePhoto): Promise<string> {
    this.assertOpen();
    const id = this.makeId();
    const extension = extensionFor(photo.mimeType);
    if (!extension) throw new Error(`A photo of type "${photo.mimeType}" cannot be stored.`);
    photoPath(inspectionId, id, extension);
    const item: PhotoItem = {
      v: 1,
      kind: "photo",
      id,
      userId: this.userId,
      inspectionId,
      seq: this.nextSeq++,
      createdAt: this.now(),
      moduleKey: tag.moduleKey,
      target: buildTarget(tag.target),
      caption,
      takenAt: photo.takenAt,
      width: photo.width,
      height: photo.height,
      flagged: photo.flagged,
      mimeType: photo.mimeType,
      extension,
      size: photo.blob.size,
      thumbSize: photo.thumbBlob ? photo.thumbBlob.size : null,
      done: { object: false, thumb: photo.thumbBlob === null, row: false },
      meta: 0,
      rowMeta: 0,
      attempts: 0,
      error: null,
      failed: false,
    };
    const parts: [Part, Blob][] = [["object", photo.blob]];
    if (photo.thumbBlob) parts.push(["thumb", photo.thumbBlob]);
    await this.keep(item, parts);
    return id;
  }

  async enqueueFile({ inspectionId, file, moduleKey, kind }: EnqueueFile): Promise<string> {
    this.assertOpen();
    const id = this.makeId();
    filePath(inspectionId, id, file.extension);
    const item: FileItem = {
      v: 1,
      kind: "file",
      id,
      userId: this.userId,
      inspectionId,
      seq: this.nextSeq++,
      createdAt: this.now(),
      moduleKey,
      fileKind: kind,
      name: file.name,
      mimeType: file.mimeType,
      extension: file.extension,
      size: file.blob.size,
      done: { object: false, row: false },
      attempts: 0,
      error: null,
      failed: false,
    };
    await this.keep(item, [["object", file.blob]]);
    return id;
  }

  async retag(id: string, { tag, caption }: { tag?: PhotoTag; caption?: string | null }): Promise<boolean> {
    const item = this.queued.get(id);
    if (!item || item.kind !== "photo") return false;
    const target = tag ? buildTarget(tag.target) : item.target;
    await this.update(item, (latest) =>
      latest.kind !== "photo"
        ? latest
        : {
            ...latest,
            moduleKey: tag ? tag.moduleKey : latest.moduleKey,
            target,
            caption: caption === undefined ? latest.caption : caption,
            meta: latest.meta + 1,
          },
    );
    void this.pump();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.queued.has(id)) return false;
    this.removing.add(id);
    try {
      if (this.current?.id === id) {
        this.current.abort.abort();
        await this.current.done;
      }
      const latest = this.queued.get(id);
      // Gone: it finished meanwhile. Row written: the queue finishes it; delete the row instead.
      if (!latest || latest.done.row) return false;
      this.queued.delete(id);
      this.progress.delete(id);
      this.emit();
      await this.discard(id);
      await this.removeObjects(latest);
      return true;
    } finally {
      this.removing.delete(id);
      void this.pump();
    }
  }

  retryNow(id?: string): void {
    if (this.phase === "stopped") return;
    for (const item of [...this.queued.values()]) {
      if (item.failed && (id === undefined || item.id === id)) {
        void this.update(item, (latest) => ({ ...latest, failed: false, error: null }));
      }
    }
    this.busyElsewhere.clear();
    this.attempts = 0;
    this.cancelRetry();
    this.emit();
    void this.pump();
  }

  pendingCount(inspectionId?: string): number {
    let count = 0;
    for (const item of this.queued.values()) {
      if (inspectionId === undefined || item.inspectionId === inspectionId) count++;
    }
    return count;
  }

  isEmpty(inspectionId: string): boolean {
    return this.pendingCount(inspectionId) === 0;
  }

  async preview(id: string): Promise<Blob | null> {
    const item = this.queued.get(id);
    if (!item || item.kind !== "photo") return null;
    const part: Part | null =
      item.thumbSize !== null ? "thumb" : ["image/jpeg", "image/png", "image/webp"].includes(item.mimeType) ? "object" : null;
    if (!part) return null;
    const read = await this.readBytes(id, part);
    return "blob" in read ? read.blob : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): UploadQueueSnapshot {
    return this.snapshot;
  }

  stop(): void {
    if (this.phase === "stopped") return;
    this.phase = "stopped";
    this.cancelRetry();
    if (this.recheckTimer !== null) clearTimeout(this.recheckTimer);
    this.recheckTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current?.abort.abort();
    this.listeners.clear();
  }

  /* ---------------------------------------------------------------- *
   * Keeping items
   * ---------------------------------------------------------------- */

  /** Writes the bytes, then the item, which is what makes the bytes count. */
  private async keep(item: QueuedItem, parts: [Part, Blob][]): Promise<void> {
    this.enqueuing.add(item.id);
    try {
      for (const [part, blob] of parts) {
        await this.blobStore.put(blobKey(item.id, part), {
          type: blob.type,
          bytes: await blob.arrayBuffer(),
          storedAt: this.now(),
        });
      }
      await this.itemStore.put(item.id, item);
    } catch {
      // Not kept on this device: upload from memory while the page stays open.
      this.localCopy = false;
      for (const [part, blob] of parts) this.memoryBlobs.set(blobKey(item.id, part), blob);
    } finally {
      this.enqueuing.delete(item.id);
    }
    this.queued.set(item.id, item);
    this.emit();
    void this.pump();
  }

  private isMemoryOnly(id: string): boolean {
    return this.memoryBlobs.has(blobKey(id, "object"));
  }

  /** Applies a change to the newest version of an item and writes it. A removed item stays removed. */
  private async update(item: QueuedItem, change: (latest: QueuedItem) => QueuedItem): Promise<QueuedItem> {
    const latest = this.queued.get(item.id);
    const next = change(latest ?? item);
    if (!latest) return next;
    this.queued.set(item.id, next);
    this.emit();
    if (!this.isMemoryOnly(item.id)) {
      try {
        await this.itemStore.put(item.id, next);
      } catch {
        this.localCopy = false;
        this.emit();
      }
    }
    return next;
  }

  private async readBytes(id: string, part: Part): Promise<BytesRead> {
    const kept = this.memoryBlobs.get(blobKey(id, part));
    if (kept) return { blob: kept };
    let raw: unknown;
    try {
      raw = await this.blobStore.get(blobKey(id, part));
    } catch {
      return { unreadable: true };
    }
    const parsed = StoredBytesSchema.safeParse(raw);
    return parsed.success ? { blob: new Blob([parsed.data.bytes], { type: parsed.data.type }) } : { missing: true };
  }

  /** Deletes the item first: without it, leftover bytes are orphans that the next start collects. */
  private async discard(id: string): Promise<void> {
    this.memoryBlobs.delete(blobKey(id, "object"));
    this.memoryBlobs.delete(blobKey(id, "thumb"));
    try {
      await this.itemStore.delete(id);
      await this.blobStore.delete(blobKey(id, "object"));
      await this.blobStore.delete(blobKey(id, "thumb"));
    } catch {
      // Collected on a later start.
    }
  }

  private async collectOrphans(): Promise<void> {
    const itemIds = new Set(await this.itemStore.keys());
    for (const key of await this.blobStore.keys()) {
      const id = key.slice(0, key.indexOf("/"));
      if (itemIds.has(id) || this.queued.has(id) || this.enqueuing.has(id)) continue;
      // Another tab may be between writing bytes and item: only old orphans go.
      const parsed = StoredBytesSchema.safeParse(await this.blobStore.get(key));
      if (parsed.success && this.now() - parsed.data.storedAt < ORPHAN_AGE_MS) continue;
      await this.blobStore.delete(key);
    }
  }

  private async removeObjects(item: QueuedItem): Promise<void> {
    const paths: string[] = [];
    if (item.done.object) paths.push(objectPath(item));
    if (item.kind === "photo" && item.thumbSize !== null && item.done.thumb) paths.push(thumbPath(item.inspectionId, item.id));
    if (paths.length === 0 || !this.storage.remove) return;
    try {
      await this.storage.remove(bucketOf(item), paths);
    } catch {
      // A leftover object costs storage, nothing else: no row points at it.
    }
  }

  /* ---------------------------------------------------------------- *
   * Uploading
   * ---------------------------------------------------------------- */

  private async pump(): Promise<void> {
    if (this.pumping || this.phase !== "running") return;
    this.pumping = true;
    try {
      while (this.phase === "running" && this.retryTimer === null) {
        const next = this.ordered().find(
          (item) => !item.failed && !this.busyElsewhere.has(item.id) && !this.removing.has(item.id),
        );
        if (!next) break;
        if ((await this.process(next.id)) === "retry") break;
      }
    } finally {
      this.pumping = false;
    }
    // Items another tab holds: look again later, in case that tab closed.
    if (this.phase === "running" && this.busyElsewhere.size > 0 && this.recheckTimer === null) {
      this.recheckTimer = setTimeout(() => {
        this.recheckTimer = null;
        this.busyElsewhere.clear();
        void this.pump();
      }, this.backoff.maxMs);
    }
  }

  private async process(id: string): Promise<TransferResult> {
    const abort = new AbortController();
    const run = this.lock(`${LOCK_PREFIX}${id}`, () => this.transfer(id, abort.signal));
    this.current = { id, abort, done: run.catch(() => undefined) };
    this.emit();
    try {
      const result = await run;
      if (result.acquired) return result.value;
      this.busyElsewhere.add(id);
      return "busy";
    } catch (error) {
      const item = this.queued.get(id);
      return item ? this.fail(item, thrownFailure(error)) : "gone";
    } finally {
      this.current = null;
      this.progress.delete(id);
      this.emit();
    }
  }

  private async transfer(id: string, signal: AbortSignal): Promise<TransferResult> {
    // Another tab may have finished or removed it since this tab loaded it.
    if (!(await this.stillQueued(id))) {
      this.queued.delete(id);
      return "gone";
    }
    let item = this.queued.get(id);
    if (!item) return "gone";
    this.setProgress(item, bytesDone(item));
    try {
      if (!item.done.object) {
        const outcome = await this.upload(item, "object", signal);
        if (signal.aborted || this.removing.has(id)) return "cancelled";
        if (!outcome.ok) return this.fail(item, outcome);
        item = await this.update(item, (latest) => markDone(latest, "object"));
      }
      if (item.kind === "photo" && !item.done.thumb) {
        const outcome = await this.upload(item, "thumb", signal);
        if (signal.aborted || this.removing.has(id)) return "cancelled";
        if (!outcome.ok) return this.fail(item, outcome);
        item = await this.update(item, (latest) => markDone(latest, "thumb"));
      }
      if (!item.done.row) {
        if (this.removing.has(id)) return "cancelled";
        const latest = this.queued.get(id) ?? item;
        const meta = latest.kind === "photo" ? latest.meta : 0;
        const outcome =
          latest.kind === "photo" ? await this.repository.insertPhoto(photoRow(latest)) : await this.repository.insertFile(fileRow(latest));
        if (!outcome.ok) return this.fail(latest, outcome);
        item = await this.update(latest, (current) => {
          const done = markDone(current, "row");
          return done.kind === "photo" ? { ...done, rowMeta: Math.max(done.rowMeta, meta) } : done;
        });
      }
      // Retagged while uploading: bring the row up to date.
      for (;;) {
        const latest = this.queued.get(id);
        if (!latest || latest.kind !== "photo" || latest.rowMeta >= latest.meta) break;
        const meta = latest.meta;
        const outcome = await this.repository.updatePhoto(id, rowPatch(latest));
        if (!outcome.ok) return this.fail(latest, outcome);
        await this.update(latest, (current) =>
          current.kind === "photo" ? { ...current, rowMeta: Math.max(current.rowMeta, meta) } : current,
        );
      }
      // No await between the last check and leaving the queue, so a retag lands before or after, never lost.
      this.finish(id);
      return "done";
    } catch (error) {
      if (signal.aborted) return "cancelled";
      return this.fail(item, thrownFailure(error));
    }
  }

  private async upload(item: QueuedItem, part: Part, signal: AbortSignal): Promise<TransferOutcome> {
    const read = await this.readBytes(item.id, part);
    if ("missing" in read) {
      return { ok: false, reason: "not_found", message: "This file is no longer stored on this device. Remove it and add it again." };
    }
    if ("unreadable" in read) {
      return { ok: false, reason: "server", message: "This device could not read the queued file. Retrying." };
    }
    const before = bytesDone(item);
    try {
      return await this.storage.upload({
        bucket: bucketOf(item),
        path: part === "thumb" ? thumbPath(item.inspectionId, item.id) : objectPath(item),
        body: read.blob,
        contentType: part === "thumb" ? "image/jpeg" : item.mimeType,
        signal,
        onProgress: (loaded) => this.setProgress(item, before + Math.min(loaded, read.blob.size)),
      });
    } catch (error) {
      return { ok: false, ...thrownFailure(error) };
    }
  }

  private async stillQueued(id: string): Promise<boolean> {
    if (this.isMemoryOnly(id)) return true;
    try {
      return (await this.itemStore.get(id)) !== undefined;
    } catch {
      return true;
    }
  }

  private async fail(item: QueuedItem, failure: Failure): Promise<TransferResult> {
    if (isRetryable(failure.reason)) {
      await this.update(item, (latest) => ({ ...latest, attempts: latest.attempts + 1, error: failure }));
      this.attempts++;
      this.lastError = failure;
      // Offline: wait for the online event, with a slow retry in case it never fires.
      this.scheduleRetry(this.online ? backoffDelay(this.attempts, this.backoff, this.random) : this.backoff.maxMs);
      return "retry";
    }
    await this.update(item, (latest) => ({ ...latest, attempts: latest.attempts + 1, error: failure, failed: true }));
    return "failed";
  }

  private finish(id: string): void {
    this.queued.delete(id);
    this.progress.delete(id);
    this.attempts = 0;
    this.lastError = null;
    this.emit();
    void this.discard(id);
  }

  private setProgress(item: QueuedItem, bytes: number): void {
    const total = totalBytes(item);
    const value = total === 0 ? 0 : Math.min(1, bytes / total);
    const previous = this.progress.get(item.id);
    if (previous !== undefined && Math.floor(previous * 100) === Math.floor(value * 100)) return;
    this.progress.set(item.id, value);
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Signals and snapshot
   * ---------------------------------------------------------------- */

  private setOnline(online: boolean): void {
    this.online = online;
    if (online && this.retryTimer !== null) {
      // Back online: retry now instead of waiting out the backoff.
      this.attempts = 0;
      this.cancelRetry();
      this.busyElsewhere.clear();
      void this.pump();
    }
    this.emit();
  }

  private scheduleRetry(delay: number): void {
    this.cancelRetry();
    if (this.phase !== "running") return;
    this.retryAt = this.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      this.busyElsewhere.clear();
      this.emit();
      void this.pump();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  private ordered(): QueuedItem[] {
    return [...this.queued.values()].sort(
      (a, b) => a.seq - b.seq || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  private computeSnapshot(): UploadQueueSnapshot {
    const items = this.ordered().map((item): UploadItem => ({
      id: item.id,
      kind: item.kind,
      inspectionId: item.inspectionId,
      moduleKey: item.moduleKey,
      target: item.kind === "photo" ? item.target : null,
      caption: item.kind === "photo" ? item.caption : null,
      name: item.kind === "file" ? item.name : null,
      flagged: item.kind === "photo" && item.flagged,
      takenAt: item.kind === "photo" ? item.takenAt : null,
      state: item.failed ? "failed" : this.current?.id === item.id ? "uploading" : "waiting",
      progress: this.progress.get(item.id) ?? bytesDone(item) / Math.max(1, totalBytes(item)),
      error: item.error,
      createdAt: item.createdAt,
    }));
    return {
      items,
      pending: items.length,
      failed: items.filter((item) => item.state === "failed").length,
      online: this.online,
      retryAt: this.retryAt,
      error: this.lastError,
      localCopy: this.localCopy,
    };
  }

  private emit(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private assertOpen(): void {
    if (this.phase === "stopped") throw new Error("The upload queue has been stopped.");
  }
}

function bucketOf(item: QueuedItem): MediaBucket {
  return item.kind === "photo" ? PHOTO_BUCKET : FILE_BUCKET;
}

function objectPath(item: QueuedItem): string {
  return item.kind === "photo"
    ? photoPath(item.inspectionId, item.id, item.extension)
    : filePath(item.inspectionId, item.id, item.extension);
}

function markDone(item: QueuedItem, step: "object" | "thumb" | "row"): QueuedItem {
  if (item.kind === "photo") return { ...item, done: { ...item.done, [step]: true } };
  return step === "thumb" ? item : { ...item, done: { ...item.done, [step]: true } };
}

function totalBytes(item: QueuedItem): number {
  return item.size + (item.kind === "photo" ? (item.thumbSize ?? 0) : 0);
}

function bytesDone(item: QueuedItem): number {
  const thumb = item.kind === "photo" && item.done.thumb ? (item.thumbSize ?? 0) : 0;
  return (item.done.object ? item.size : 0) + thumb;
}

function photoRow(item: PhotoItem): PhotoRow {
  return {
    id: item.id,
    inspection_id: item.inspectionId,
    module_key: item.moduleKey,
    target: item.target,
    storage_path: photoPath(item.inspectionId, item.id, item.extension),
    thumb_path: item.thumbSize === null ? null : thumbPath(item.inspectionId, item.id),
    caption: item.caption,
    taken_at: item.takenAt,
    width: item.width,
    height: item.height,
    flagged: item.flagged,
  };
}

function rowPatch(item: PhotoItem): PhotoRowPatch {
  return { module_key: item.moduleKey, target: item.target, caption: item.caption };
}

function fileRow(item: FileItem): FileRow {
  return {
    id: item.id,
    inspection_id: item.inspectionId,
    module_key: item.moduleKey,
    kind: item.fileKind,
    storage_path: filePath(item.inspectionId, item.id, item.extension),
    name: item.name,
  };
}
