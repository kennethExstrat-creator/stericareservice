import { z } from "zod";
import { AUTOSAVE_BACKOFF, backoffDelay, type Backoff } from "./backoff";
import { defaultConnectivity, defaultLifecycle, type Connectivity, type PageLifecycle } from "./connectivity";
import {
  MAX_SENT_HASHES,
  hasUnsavedChanges,
  readDraft,
  reconcile,
  writeDraft,
  type DraftOwner,
  type LocalDraft,
  type Reconciliation,
} from "./drafts";
import { FAILURE_MESSAGES, isRetryable, thrownFailure, type Failure, type FailureReason } from "./failures";
import type { KeyValueStore } from "./kv";
import { saveOutcomeSchema, type AutosaveTransport, type SaveOutcome, type ServerCopy } from "./protocol";
import { contentHash } from "./stable-json";

/* ------------------------------------------------------------------ *
 * Autosave for the capture screen (BUILD_SPEC 8, docs/OFFLINE.md).
 *
 * Every change is written to the local copy first, then saved after a
 * quiet spell through the transport, one request at a time, with
 * compare-and-set on the server's updated_at. Failures retry with backoff;
 * a conflict waits for the inspector.
 * ------------------------------------------------------------------ */

export const AUTOSAVE_DEBOUNCE_MS = 800;
/** Continuous tapping still saves this often. */
export const AUTOSAVE_MAX_WAIT_MS = 5_000;
/** After this a request counts as stalled: the pill shows offline and the request is aborted if the transport supports it. */
export const AUTOSAVE_REQUEST_TIMEOUT_MS = 30_000;
export const AUTOSAVE_FLUSH_TIMEOUT_MS = 20_000;
/** Automatic re-sends after the server moved through this device's own writes, before asking the inspector. */
const MAX_REBASES = 3;

export const CONFLICT_MESSAGE = "This inspection was changed on another device while this one had unsaved changes.";
export const STORAGE_MESSAGE =
  "Changes cannot be kept on this device and are not saved yet. Keep this page open until the connection is back.";

export type AutosaveStatus = "saved" | "saving" | "offline" | "error";

export type AutosaveErrorReason = FailureReason | "conflict" | "storage";

export interface AutosaveError {
  reason: AutosaveErrorReason;
  message: string;
}

export interface AutosaveConflict<T> {
  /** This device's unsaved data, and when it last changed (device time, ms). */
  local: { data: T; changedAt: number };
  server: ServerCopy<T>;
}

export interface AutosaveSnapshot<T> {
  /** For the pill: Saved, Saving, Offline (will sync), or an error that needs the inspector. */
  status: AutosaveStatus;
  /** Changes the server has not confirmed yet. */
  pending: boolean;
  /** Device time (ms) of the last confirmed save, for "Saved 10:42". */
  lastSavedAt: number | null;
  online: boolean;
  /** Why the status is error, or offline. */
  error: AutosaveError | null;
  conflict: AutosaveConflict<T> | null;
  /** Device time (ms) of the next automatic retry. */
  retryAt: number | null;
  /** False when changes cannot be kept on this device (no IndexedDB, or it failed). */
  localCopy: boolean;
}

export type StartResult<T> =
  /** Render `data`. `setAside`: an unreadable older local copy was moved aside instead of applied. */
  | { kind: "current"; data: T; setAside?: true }
  /** Unsaved changes from this device were applied and are being saved: render `data`. */
  | { kind: "restored"; data: T; changedAt: number }
  /** Ask the inspector, then call resolveConflict(). Saving waits until then. */
  | { kind: "conflict"; local: { data: T; changedAt: number }; server: ServerCopy<T> };

export type FlushResult =
  | { ok: true }
  | { ok: false; reason: AutosaveErrorReason | "timeout" | "stopped"; message: string };

export interface AutosaveOptions<T> {
  inspectionId: string;
  userId: string;
  transport: AutosaveTransport<T>;
  /** The "drafts" store of the offline database (lib/offline/db.ts). */
  store: KeyValueStore<unknown>;
  /** Checks a restored local copy; one that fails is set aside, never applied or deleted. */
  dataSchema?: z.ZodType<T>;
  connectivity?: Connectivity;
  lifecycle?: PageLifecycle;
  debounceMs?: number;
  maxWaitMs?: number;
  requestTimeoutMs?: number;
  backoff?: Backoff;
  now?: () => number;
  random?: () => number;
}

export interface AutosaveController<T> {
  /** Loads the local copy and settles it against the server's copy (the page's data). Call once. */
  start(server: ServerCopy<T>): Promise<StartResult<T>>;
  /** The inspector changed something: pass the whole new data (a new object, as React state is). */
  change(data: T): void;
  /** Saves now and waits for the server, e.g. before submit. Does not wait out an outage: it reports it. */
  flush(options?: { timeoutMs?: number }): Promise<FlushResult>;
  /** Keeps this device's data (saved over the server's) or the server's (local changes dropped). Returns the data to render. */
  resolveConflict(keep: "local" | "server"): T;
  /** Retries at once, e.g. from a "Try again" button or after signing in again. */
  retryNow(): void;
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): AutosaveSnapshot<T>;
  /** Stops timers and listeners; unsaved changes stay in the local copy for the next start. */
  stop(): Promise<void>;
}

export function createAutosave<T>(options: AutosaveOptions<T>): AutosaveController<T> {
  return new Autosave(options);
}

type TimerName = "debounce" | "maxWait" | "retry" | "timeout";

const OUTCOME = saveOutcomeSchema(z.unknown());

const STOPPED: FlushResult = { ok: false, reason: "stopped", message: "Autosave has stopped." };
// Shared objects keep the snapshot identical between emits (useSyncExternalStore compares by reference).
const CONFLICT_ERROR: AutosaveError = { reason: "conflict", message: CONFLICT_MESSAGE };
const STORAGE_ERROR: AutosaveError = { reason: "storage", message: STORAGE_MESSAGE };

class Autosave<T> implements AutosaveController<T> {
  private readonly owner: DraftOwner;
  private readonly transport: AutosaveTransport<T>;
  private readonly store: KeyValueStore<unknown>;
  private readonly dataSchema?: z.ZodType<T>;
  private readonly connectivity: Connectivity;
  private readonly lifecycle: PageLifecycle;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly requestTimeoutMs: number;
  private readonly backoff: Backoff;
  private readonly now: () => number;
  private readonly random: () => number;

  private phase: "new" | "starting" | "running" | "stopped" = "new";
  private draft: LocalDraft<T> | null = null;
  private inflight = false;
  /** More changes arrived while a request was in flight. */
  private sendAgain = false;
  /** The request in flight passed its timeout. */
  private slow = false;
  private attempts = 0;
  private rebases = 0;
  private retryAt: number | null = null;
  private failure: Failure | null = null;
  private conflict: AutosaveConflict<T> | null = null;
  private online: boolean;
  private readonly timers: Record<TimerName, ReturnType<typeof setTimeout> | null> = {
    debounce: null,
    maxWait: null,
    retry: null,
    timeout: null,
  };

  /** Local writes: one running, at most one queued (which writes the newest state when it starts). */
  private lastWrite: Promise<void> = Promise.resolve();
  private queuedWrite: Promise<void> | null = null;
  private localError: string | null = null;
  /** Reading the local copy failed: never overwrite what may be unsynced work. */
  private localDisabled = false;

  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Set<(result: FlushResult) => void>();
  private readonly cleanups: (() => void)[] = [];
  private snapshot: AutosaveSnapshot<T>;

  constructor(options: AutosaveOptions<T>) {
    this.owner = { userId: options.userId, inspectionId: options.inspectionId };
    this.transport = options.transport;
    this.store = options.store;
    this.dataSchema = options.dataSchema;
    this.connectivity = options.connectivity ?? defaultConnectivity();
    this.lifecycle = options.lifecycle ?? defaultLifecycle();
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? AUTOSAVE_REQUEST_TIMEOUT_MS;
    this.backoff = options.backoff ?? AUTOSAVE_BACKOFF;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.online = this.connectivity.isOnline();
    this.snapshot = this.computeSnapshot();
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  async start(server: ServerCopy<T>): Promise<StartResult<T>> {
    if (this.phase !== "new") throw new Error("Autosave has already been started.");
    this.phase = "starting";

    let local: LocalDraft<T> | null = null;
    let setAside = false;
    try {
      const read = await readDraft(this.store, this.owner, this.dataSchema, this.now());
      if (read.status === "ok") local = read.draft;
      setAside = read.status === "unreadable";
    } catch (error) {
      this.localDisabled = true;
      this.localError = describeError(error);
    }

    const outcome = reconcile(local, server, this.owner, this.now());
    // Stopped while loading (the screen unmounted): report, but run nothing.
    if (this.phase !== "starting") return startResult(outcome, setAside);

    this.phase = "running";
    this.online = this.connectivity.isOnline();
    this.cleanups.push(
      this.connectivity.subscribe((online) => this.setOnline(online)),
      this.lifecycle.onHidden(() => this.onHidden()),
    );

    if (outcome.kind === "conflict") {
      this.draft = outcome.local;
      this.conflict = { local: { data: outcome.local.data, changedAt: outcome.local.changedAt }, server: outcome.server };
    } else {
      this.draft = outcome.draft;
      void this.persist();
      // Restored changes have waited long enough: save them now.
      if (outcome.kind === "restored") this.save();
    }
    this.emit();
    return startResult(outcome, setAside);
  }

  change(data: T): void {
    const draft = this.requireDraft();
    this.draft = { ...draft, data, revision: draft.revision + 1, changedAt: this.now() };
    // The edit may fix refused data, or the inspection may be editable again.
    if (this.failure && !isRetryable(this.failure.reason)) this.failure = null;
    void this.persist();
    this.schedule();
    this.emit();
  }

  flush({ timeoutMs = AUTOSAVE_FLUSH_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<FlushResult> {
    if (this.phase !== "running" || !this.draft) return Promise.resolve(STOPPED);
    if (this.conflict) return Promise.resolve({ ok: false, reason: "conflict", message: CONFLICT_MESSAGE });
    if (!this.inflight && !hasUnsavedChanges(this.draft)) return Promise.resolve({ ok: true });

    return new Promise<FlushResult>((resolve) => {
      const finish = (result: FlushResult) => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ ok: false, reason: "timeout", message: "Saving is taking too long. Check the connection and try again." }),
        timeoutMs,
      );
      this.waiters.add(finish);
      // Try now, whatever the backoff says; failures from here on settle this flush.
      this.failure = null;
      this.attempts = 0;
      this.cancelRetry();
      this.save();
      this.emit();
    });
  }

  resolveConflict(keep: "local" | "server"): T {
    const { conflict, draft } = this;
    if (!conflict || !draft) throw new Error("There is no conflict to resolve.");
    const serverHash = contentHash(conflict.server.data);
    this.conflict = null;
    this.failure = null;
    this.attempts = 0;
    this.rebases = 0;

    if (keep === "local") {
      // Save this device's data over the server's, on top of the version just seen.
      this.draft = { ...draft, baseUpdatedAt: conflict.server.updatedAt, baseHash: serverHash };
      void this.persist();
      this.save();
    } else {
      const revision = draft.revision + 1;
      this.draft = {
        ...draft,
        data: conflict.server.data,
        revision,
        syncedRevision: revision,
        baseUpdatedAt: conflict.server.updatedAt,
        baseHash: serverHash,
        sentHashes: [],
        changedAt: this.now(),
      };
      void this.persist();
      this.settle();
    }
    this.emit();
    return this.draft.data;
  }

  retryNow(): void {
    if (this.phase !== "running" || this.conflict) return;
    this.failure = null;
    this.attempts = 0;
    this.cancelRetry();
    this.save();
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): AutosaveSnapshot<T> {
    return this.snapshot;
  }

  async stop(): Promise<void> {
    if (this.phase === "stopped") return;
    const wasRunning = this.phase === "running";
    this.phase = "stopped";
    for (const name of Object.keys(this.timers) as TimerName[]) this.clear(name);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const resolve of [...this.waiters]) resolve(STOPPED);
    this.listeners.clear();
    if (wasRunning) await this.persist();
  }

  /* ---------------------------------------------------------------- *
   * Saving
   * ---------------------------------------------------------------- */

  private schedule(): void {
    // A conflict waits for the inspector; a pending retry will send the newest data anyway.
    if (this.conflict || this.timers.retry !== null) return;
    this.clear("debounce");
    this.timers.debounce = setTimeout(() => this.save(), this.debounceMs);
    this.timers.maxWait ??= setTimeout(() => this.save(), this.maxWaitMs);
  }

  private save(): void {
    this.clear("debounce");
    this.clear("maxWait");
    if (this.phase !== "running" || !this.draft) return;
    if (this.inflight) {
      this.sendAgain = true;
      return;
    }
    if (this.conflict || !hasUnsavedChanges(this.draft)) {
      this.settle();
      return;
    }
    void this.send(this.draft);
  }

  private async send(draft: LocalDraft<T>): Promise<void> {
    const { revision, data, baseUpdatedAt } = draft;
    const hash = contentHash(data);
    this.inflight = true;
    if (!draft.sentHashes.includes(hash)) {
      this.draft = { ...draft, sentHashes: [...draft.sentHashes, hash].slice(-MAX_SENT_HASHES) };
    }
    this.emit();
    // The local copy, which now remembers this payload, is on disk before the request leaves.
    await this.persist();

    const abort = new AbortController();
    this.timers.timeout = setTimeout(() => {
      this.timers.timeout = null;
      this.slow = true;
      abort.abort();
      this.emit();
    }, this.requestTimeoutMs);

    let outcome: SaveOutcome<T>;
    try {
      const answer = await this.transport.save({
        inspectionId: this.owner.inspectionId,
        data,
        baseUpdatedAt,
        signal: abort.signal,
      });
      outcome = OUTCOME.safeParse(answer).success
        ? answer
        : { ok: false, reason: "server", message: "The server answered in an unexpected format." };
    } catch (error) {
      outcome = { ok: false, ...thrownFailure(error) };
    }
    this.clear("timeout");
    this.slow = false;
    this.inflight = false;

    if (outcome.ok) this.confirm(outcome.updatedAt, hash, revision);
    else if (outcome.reason === "conflict") this.serverMoved(outcome.server);
    else this.fail({ reason: outcome.reason, message: outcome.message ?? FAILURE_MESSAGES[outcome.reason] }, revision);
  }

  private confirm(updatedAt: string, hash: string, revision: number): void {
    const draft = this.requireAnyDraft();
    this.draft = {
      ...draft,
      syncedRevision: Math.max(draft.syncedRevision, revision),
      baseUpdatedAt: updatedAt,
      baseHash: hash,
      sentHashes: [],
      savedAt: this.now(),
    };
    this.failure = null;
    this.attempts = 0;
    this.rebases = 0;
    void this.persist();
    this.next(this.sendAgain);
  }

  /** The compare-and-set missed: the server is at another version. */
  private serverMoved(server: ServerCopy<T>): void {
    const draft = this.requireAnyDraft();
    const serverHash = contentHash(server.data);
    if (serverHash === contentHash(draft.data)) {
      // An earlier send landed and nothing changed since: all saved.
      this.confirm(server.updatedAt, serverHash, draft.revision);
      return;
    }
    const ours = serverHash === draft.baseHash || draft.sentHashes.includes(serverHash);
    if (ours && this.rebases < MAX_REBASES) {
      // The server moved through this device's own lost save, or through columns other than data.
      this.rebases++;
      this.draft = { ...draft, baseUpdatedAt: server.updatedAt, baseHash: serverHash };
      void this.persist();
      this.next(true);
      return;
    }
    this.conflict = { local: { data: draft.data, changedAt: draft.changedAt }, server };
    this.clear("debounce");
    this.clear("maxWait");
    this.cancelRetry();
    this.next(false);
  }

  private fail(failure: Failure, revision: number): void {
    this.failure = failure;
    if (isRetryable(failure.reason)) {
      this.attempts++;
      // Offline: wait for the online event, with a slow retry in case it never fires.
      this.scheduleRetry(this.online ? backoffDelay(this.attempts, this.backoff, this.random) : this.backoff.maxMs);
      this.next(false);
      return;
    }
    // Refused: newer changes made meanwhile may fix it, so send those; otherwise wait for a change.
    this.next(this.sendAgain && (this.draft?.revision ?? 0) > revision);
  }

  private next(sendNow: boolean): void {
    this.sendAgain = false;
    if (sendNow) this.save();
    this.settle();
    this.emit();
  }

  private scheduleRetry(delay: number): void {
    this.cancelRetry();
    if (this.phase !== "running") return;
    this.clear("debounce");
    this.clear("maxWait");
    this.retryAt = this.now() + delay;
    this.timers.retry = setTimeout(() => {
      this.timers.retry = null;
      this.retryAt = null;
      this.save();
      this.emit();
    }, delay);
  }

  private cancelRetry(): void {
    this.clear("retry");
    this.retryAt = null;
  }

  /** Settles flush() calls once there is an answer: all saved, a conflict, or a failure. */
  private settle(): void {
    if (this.waiters.size === 0 || this.inflight || !this.draft) return;
    let result: FlushResult | null = null;
    if (this.conflict) result = { ok: false, reason: "conflict", message: CONFLICT_MESSAGE };
    else if (!hasUnsavedChanges(this.draft)) result = { ok: true };
    else if (this.failure) result = { ok: false, reason: this.failure.reason, message: this.failure.message };
    if (!result) return;
    for (const resolve of [...this.waiters]) resolve(result);
  }

  /* ---------------------------------------------------------------- *
   * Signals
   * ---------------------------------------------------------------- */

  private setOnline(online: boolean): void {
    this.online = online;
    if (online && this.timers.retry !== null) {
      // Back online: retry now instead of waiting out the backoff.
      this.attempts = 0;
      this.cancelRetry();
      this.save();
    }
    this.emit();
  }

  private onHidden(): void {
    if (this.phase !== "running") return;
    // The page may not come back: the local copy is already written; send what is waiting now.
    void this.persist();
    if (this.timers.debounce !== null || this.timers.maxWait !== null) this.save();
  }

  /* ---------------------------------------------------------------- *
   * Local copy
   * ---------------------------------------------------------------- */

  /** Resolves once the local copy holds the state at the time of the call (or the write failed). */
  private persist(): Promise<void> {
    if (this.localDisabled || !this.draft) return Promise.resolve();
    if (!this.queuedWrite) {
      const write = this.lastWrite.then(async () => {
        this.queuedWrite = null;
        const draft = this.draft;
        if (!draft) return;
        try {
          await writeDraft(this.store, draft);
          if (this.localError !== null) {
            this.localError = null;
            this.emit();
          }
        } catch (error) {
          this.localError = describeError(error);
          this.emit();
        }
      });
      this.queuedWrite = write;
      this.lastWrite = write;
    }
    return this.queuedWrite;
  }

  /* ---------------------------------------------------------------- *
   * Snapshot
   * ---------------------------------------------------------------- */

  private computeSnapshot(): AutosaveSnapshot<T> {
    const pending = this.draft ? hasUnsavedChanges(this.draft) : false;
    const { status, error } = this.describe(pending);
    return {
      status,
      pending,
      lastSavedAt: this.draft?.savedAt ?? null,
      online: this.online,
      error,
      conflict: this.conflict,
      retryAt: this.retryAt,
      localCopy: !this.localDisabled && this.localError === null,
    };
  }

  private describe(pending: boolean): { status: AutosaveStatus; error: AutosaveError | null } {
    if (this.conflict) return { status: "error", error: CONFLICT_ERROR };
    if (this.failure && !isRetryable(this.failure.reason)) return { status: "error", error: this.failure };
    if (!pending) return { status: "saved", error: null };
    const struggling = this.failure !== null || !this.online || this.slow;
    const kept = !this.localDisabled && this.localError === null;
    if (struggling && !kept) return { status: "error", error: STORAGE_ERROR };
    if (this.failure?.reason === "unauthorized") return { status: "error", error: this.failure };
    if (struggling) return { status: "offline", error: this.failure };
    return { status: "saving", error: null };
  }

  private emit(): void {
    const next = this.computeSnapshot();
    const previous = this.snapshot as unknown as Record<string, unknown>;
    const changed = Object.entries(next).some(([key, value]) => !Object.is(previous[key], value));
    if (!changed) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  private requireDraft(): LocalDraft<T> {
    if (this.phase === "stopped") throw new Error("Autosave has been stopped.");
    if (this.phase !== "running" || !this.draft) throw new Error("Call start() before change().");
    return this.draft;
  }

  /** In-flight answers may arrive after stop(); they still update the local copy. */
  private requireAnyDraft(): LocalDraft<T> {
    if (!this.draft) throw new Error("Autosave has no data.");
    return this.draft;
  }

  private clear(name: TimerName): void {
    const timer = this.timers[name];
    if (timer !== null) clearTimeout(timer);
    this.timers[name] = null;
  }
}

function startResult<T>(outcome: Reconciliation<T>, setAside: boolean): StartResult<T> {
  switch (outcome.kind) {
    case "conflict":
      return {
        kind: "conflict",
        local: { data: outcome.local.data, changedAt: outcome.local.changedAt },
        server: outcome.server,
      };
    case "restored":
      return { kind: "restored", data: outcome.data, changedAt: outcome.draft.changedAt };
    case "current":
      return setAside ? { kind: "current", data: outcome.data, setAside: true } : { kind: "current", data: outcome.data };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
