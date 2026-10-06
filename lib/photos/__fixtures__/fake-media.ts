import type { MediaBucket } from "../paths";
import type {
  FileRow,
  ItemLock,
  MediaRepository,
  PhotoRow,
  PhotoRowPatch,
  TransferOutcome,
  UploadRequest,
  UploadStorage,
} from "../upload-queue";

/** A promise that stays pending until opened. */
class Gate {
  private promise: Promise<void> | null = null;
  private open: (() => void) | null = null;

  close() {
    this.promise = new Promise<void>((resolve) => (this.open = resolve));
  }

  release() {
    this.open?.();
    this.promise = null;
  }

  async pass(signal?: AbortSignal) {
    if (!this.promise) return;
    if (!signal) return this.promise;
    await Promise.race([this.promise, new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))]);
  }
}

const LOST: TransferOutcome = { ok: false, reason: "network", message: "The network connection was lost." };

/**
 * Supabase Storage as the queue's contract describes it: an object that
 * already exists counts as uploaded and is never overwritten.
 */
export class FakeStorage implements UploadStorage {
  readonly objects = new Map<string, { contentType: string; size: number }>();
  readonly calls: string[] = [];
  readonly signals: AbortSignal[] = [];
  readonly scripted: TransferOutcome[] = [];
  reachable = true;
  /** The next upload is stored, then its answer is lost. */
  loseNextAnswer = false;
  private readonly gate = new Gate();

  hold() {
    this.gate.close();
  }

  release() {
    this.gate.release();
  }

  async upload({ bucket, path, body, contentType, signal, onProgress }: UploadRequest): Promise<TransferOutcome> {
    const key = `${bucket}/${path}`;
    this.calls.push(`upload ${key}`);
    this.signals.push(signal);
    await this.gate.pass(signal);
    if (signal.aborted) return { ok: false, reason: "network", message: "The upload was cancelled." };
    if (!this.reachable) throw new TypeError("Load failed");
    const scripted = this.scripted.shift();
    if (scripted) return scripted;
    onProgress?.(Math.round(body.size / 2), body.size);
    onProgress?.(body.size, body.size);
    if (!this.objects.has(key)) this.objects.set(key, { contentType, size: body.size });
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      return LOST;
    }
    return { ok: true };
  }

  async remove(bucket: MediaBucket, paths: string[]): Promise<TransferOutcome> {
    this.calls.push(`remove ${bucket} ${paths.join(" ")}`);
    for (const path of paths) this.objects.delete(`${bucket}/${path}`);
    return { ok: true };
  }
}

/** The inspection_photos and inspection_files tables, with the contract's duplicate rule. */
export class FakeRepository implements MediaRepository {
  readonly photos = new Map<string, PhotoRow>();
  readonly files = new Map<string, FileRow>();
  readonly calls: string[] = [];
  readonly scripted: TransferOutcome[] = [];
  reachable = true;
  loseNextAnswer = false;
  /** The next updatePhoto answers this instead of writing. */
  failNextUpdate: TransferOutcome | null = null;
  private readonly gate = new Gate();

  hold() {
    this.gate.close();
  }

  release() {
    this.gate.release();
  }

  async insertPhoto(row: PhotoRow): Promise<TransferOutcome> {
    return this.write(`insertPhoto ${row.id}`, () => {
      if (!this.photos.has(row.id)) this.photos.set(row.id, structuredClone(row));
    });
  }

  async updatePhoto(id: string, patch: PhotoRowPatch): Promise<TransferOutcome> {
    const failure = this.failNextUpdate;
    if (failure) {
      this.failNextUpdate = null;
      this.calls.push(`updatePhoto ${id} failed`);
      return failure;
    }
    return this.write(`updatePhoto ${id} ${patch.target ?? ""}`, () => {
      const row = this.photos.get(id);
      if (row) this.photos.set(id, { ...row, ...patch });
    });
  }

  async insertFile(row: FileRow): Promise<TransferOutcome> {
    return this.write(`insertFile ${row.id}`, () => {
      if (!this.files.has(row.id)) this.files.set(row.id, structuredClone(row));
    });
  }

  private async write(call: string, apply: () => void): Promise<TransferOutcome> {
    this.calls.push(call);
    await this.gate.pass();
    if (!this.reachable) return { ok: false, reason: "network", message: "No connection." };
    const scripted = this.scripted.shift();
    if (scripted) return scripted;
    apply();
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      return LOST;
    }
    return { ok: true };
  }
}

/** Locks shared with "other tabs": names in `elsewhere` are held by one. */
export function fakeLock(elsewhere: Set<string>): ItemLock {
  return async (name, run) => (elsewhere.has(name) ? { acquired: false } : { acquired: true, value: await run() });
}
