import { z } from "zod";
import type { KeyValueStore } from "./kv";
import type { ServerCopy } from "./protocol";
import { contentHash } from "./stable-json";
import { compareVersions } from "./version";

/* ------------------------------------------------------------------ *
 * The local copy of an inspection's data (the "drafts" store), and the
 * rule that decides, on a reload, between it and the server's copy
 * (docs/OFFLINE.md, "Reload and conflicts").
 * ------------------------------------------------------------------ */

/** How many unconfirmed sends are remembered. More only happens after a long run of lost answers. */
export const MAX_SENT_HASHES = 20;

export const LocalDraftSchema = z
  .object({
    /** Record format; bump with a migration when the shape changes. */
    v: z.literal(1),
    userId: z.string().min(1),
    inspectionId: z.string().min(1),
    data: z.unknown(),
    /** Counts every change made on this device. */
    revision: z.number().int().nonnegative(),
    /** The last revision the server confirmed. Below `revision`: unsaved changes. */
    syncedRevision: z.number().int().nonnegative(),
    /** The server version (updated_at) the data was last confirmed at. */
    baseUpdatedAt: z.string().min(1),
    /** contentHash of the data at baseUpdatedAt. */
    baseHash: z.string().min(1),
    /** contentHash of each payload sent since, whose answer never arrived. */
    sentHashes: z.array(z.string()).max(MAX_SENT_HASHES),
    /** Device time (ms) of the last change. */
    changedAt: z.number(),
    /** Device time (ms) of the last save the server confirmed. */
    savedAt: z.number().nullable(),
  })
  .refine((draft) => draft.syncedRevision <= draft.revision, { message: "syncedRevision is ahead of revision." });

export type LocalDraft<T = unknown> = Omit<z.infer<typeof LocalDraftSchema>, "data"> & { data: T };

export interface DraftOwner {
  userId: string;
  inspectionId: string;
}

const DRAFT_PREFIX = "draft:";
const QUARANTINE_PREFIX = "unreadable:";

/** One local copy per user and inspection: a shared iPad never mixes two inspectors' work. */
export function draftKey({ userId, inspectionId }: DraftOwner): string {
  return `${DRAFT_PREFIX}${userId}:${inspectionId}`;
}

export function hasUnsavedChanges(draft: Pick<LocalDraft, "revision" | "syncedRevision">): boolean {
  return draft.revision > draft.syncedRevision;
}

/* ------------------------------------------------------------------ *
 * Reload rule
 * ------------------------------------------------------------------ */

export type Reconciliation<T> =
  /** Nothing to restore: render `data`, the newest state this device knows the server holds. */
  | { kind: "current"; data: T; draft: LocalDraft<T> }
  /** Unsaved changes from this device, safe to apply: render `data` and save it. */
  | { kind: "restored"; data: T; draft: LocalDraft<T> }
  /** Unsaved changes here, and someone else changed the server copy: ask which to keep. */
  | { kind: "conflict"; local: LocalDraft<T>; server: ServerCopy<T> };

/**
 * Decides between the local copy and the server's copy of an inspection.
 *
 * - No unsaved local changes: the server copy wins, unless it is older than
 *   the version this device last confirmed (a page served from the browser's
 *   back/forward cache); then the local copy, which is that newer state, wins.
 * - Unsaved local changes are applied when the server copy is that same
 *   version or older, or when its data is what this device last confirmed
 *   or sent (only other columns moved, or a save landed whose answer was
 *   lost). If the server data already equals the local data, nothing is left
 *   to save.
 * - Otherwise someone else changed the data: a conflict.
 */
export function reconcile<T>(
  local: LocalDraft<T> | null,
  server: ServerCopy<T>,
  owner: DraftOwner,
  now: number,
): Reconciliation<T> {
  const serverHash = contentHash(server.data);
  const synced = (data: T, base: { updatedAt: string; hash: string }): LocalDraft<T> => ({
    v: 1,
    userId: owner.userId,
    inspectionId: owner.inspectionId,
    data,
    revision: local?.revision ?? 0,
    syncedRevision: local?.revision ?? 0,
    baseUpdatedAt: base.updatedAt,
    baseHash: base.hash,
    sentHashes: [],
    changedAt: local?.changedAt ?? now,
    savedAt: local?.savedAt ?? null,
  });
  const serverBase = { updatedAt: server.updatedAt, hash: serverHash };

  if (!local) return { kind: "current", data: server.data, draft: synced(server.data, serverBase) };

  const order = compareVersions(server.updatedAt, local.baseUpdatedAt);
  const serverIsStale = order === -1;
  const localBase = { updatedAt: local.baseUpdatedAt, hash: local.baseHash };

  if (!hasUnsavedChanges(local)) {
    return serverIsStale
      ? { kind: "current", data: local.data, draft: local }
      : { kind: "current", data: server.data, draft: synced(server.data, serverBase) };
  }

  if (contentHash(local.data) === serverHash) {
    return { kind: "current", data: server.data, draft: synced(server.data, serverIsStale ? localBase : serverBase) };
  }
  if (serverIsStale || order === 0) {
    return { kind: "restored", data: local.data, draft: local };
  }
  if (serverHash === local.baseHash || local.sentHashes.includes(serverHash)) {
    return {
      kind: "restored",
      data: local.data,
      draft: { ...local, baseUpdatedAt: server.updatedAt, baseHash: serverHash },
    };
  }
  return { kind: "conflict", local, server };
}

/* ------------------------------------------------------------------ *
 * Store helpers
 * ------------------------------------------------------------------ */

export type DraftRead<T> =
  | { status: "missing" }
  | { status: "ok"; draft: LocalDraft<T> }
  /** Stored, but not in a shape this version reads: it was set aside under another key, never deleted. */
  | { status: "unreadable"; quarantinedAs: string };

/**
 * Reads the local copy. One that no longer validates (an older app version,
 * or `data` failing the current schema) is moved aside rather than
 * overwritten, so unsynced work is never destroyed by an upgrade.
 */
export async function readDraft<T>(
  store: KeyValueStore<unknown>,
  owner: DraftOwner,
  dataSchema?: z.ZodType<T>,
  now: number = Date.now(),
): Promise<DraftRead<T>> {
  const key = draftKey(owner);
  const raw = await store.get(key);
  if (raw === undefined) return { status: "missing" };

  const envelope = LocalDraftSchema.safeParse(raw);
  const data = envelope.success && dataSchema ? dataSchema.safeParse(envelope.data.data) : null;
  const sameOwner =
    envelope.success && envelope.data.userId === owner.userId && envelope.data.inspectionId === owner.inspectionId;
  if (envelope.success && sameOwner && (!data || data.success)) {
    return { status: "ok", draft: { ...envelope.data, data: (data ? data.data : envelope.data.data) as T } };
  }

  const quarantinedAs = `${QUARANTINE_PREFIX}${owner.userId}:${owner.inspectionId}:${now}`;
  await store.put(quarantinedAs, raw);
  await store.delete(key);
  return { status: "unreadable", quarantinedAs };
}

export function writeDraft<T>(store: KeyValueStore<unknown>, draft: LocalDraft<T>): Promise<void> {
  return store.put(draftKey(draft), draft);
}

/** For read-only screens: unsaved local changes the server does not have, if any. */
export async function findUnsavedDraft<T>(
  store: KeyValueStore<unknown>,
  owner: DraftOwner,
  server: Pick<ServerCopy<T>, "data">,
): Promise<LocalDraft<T> | null> {
  const read = await readDraft<T>(store, owner);
  if (read.status !== "ok" || !hasUnsavedChanges(read.draft)) return null;
  return contentHash(read.draft.data) === contentHash(server.data) ? null : read.draft;
}

export function discardDraft(store: KeyValueStore<unknown>, owner: DraftOwner): Promise<void> {
  return store.delete(draftKey(owner));
}

/** Inspections with changes only this device has, e.g. to warn before signing out. */
export async function listUnsavedDrafts(store: KeyValueStore<unknown>, userId: string): Promise<LocalDraft[]> {
  const prefix = `${DRAFT_PREFIX}${userId}:`;
  const drafts: LocalDraft[] = [];
  for (const key of await store.keys()) {
    if (!key.startsWith(prefix)) continue;
    const parsed = LocalDraftSchema.safeParse(await store.get(key));
    if (parsed.success && hasUnsavedChanges(parsed.data)) drafts.push(parsed.data);
  }
  return drafts;
}

/**
 * Deletes fully synced local copies last touched before `before` (ms).
 * Unsynced ones and set-aside unreadable ones are kept. Returns how many
 * were deleted.
 */
export async function pruneSyncedDrafts(store: KeyValueStore<unknown>, before: number): Promise<number> {
  let deleted = 0;
  for (const key of await store.keys()) {
    if (!key.startsWith(DRAFT_PREFIX)) continue;
    const parsed = LocalDraftSchema.safeParse(await store.get(key));
    if (!parsed.success || hasUnsavedChanges(parsed.data)) continue;
    if (Math.max(parsed.data.changedAt, parsed.data.savedAt ?? 0) < before) {
      await store.delete(key);
      deleted++;
    }
  }
  return deleted;
}
