import { z } from "zod";
import type { DraftOwner } from "./drafts";
import type { KeyValueStore } from "./kv";

/* ------------------------------------------------------------------ *
 * Entries a number field refused ("2 42" is not stored), kept on this
 * device beside the local copy of the data, never in it (BUILD_SPEC 6.2
 * rule 1: text is never stored). The capture screen keeps them per user and
 * inspection, so the refused text and its reason come back after a size or
 * section switch and after a reload, until a number lands where it was typed
 * (docs/OFFLINE.md, "The local database").
 * ------------------------------------------------------------------ */

const REFUSED_PREFIX = "refused:";

/** At most this many are kept per inspection: more is a paste gone wrong, and the oldest go first. */
export const MAX_REFUSED_ENTRIES = 500;

export const StoredRefusedEntrySchema = z.strictObject({
  /** The data the section's values live in: a module's or a custom module's. */
  namespace: z.enum(["modules", "custom"]),
  /** The section (module or custom module key). */
  section: z.string().min(1),
  /** The issue path of the field, relative to the section's data. */
  path: z.array(z.union([z.string(), z.number()])).readonly(),
  /** The text as typed. */
  raw: z.string(),
  /** Why it was refused, e.g. "One number per cell." */
  error: z.string(),
  /** The field's name, e.g. "Length, No. 3", for lists away from the field. */
  label: z.string().optional(),
});

export type StoredRefusedEntry = z.infer<typeof StoredRefusedEntrySchema>;

const RefusedRecordSchema = z.object({
  /** Record format; bump with a migration when the shape changes. */
  v: z.literal(1),
  userId: z.string().min(1),
  inspectionId: z.string().min(1),
  entries: z.array(StoredRefusedEntrySchema),
  /** Device time (ms) of the last change. */
  changedAt: z.number(),
});

/** One record per user and inspection, in the drafts store beside the local copy. */
export function refusedEntriesKey({ userId, inspectionId }: DraftOwner): string {
  return `${REFUSED_PREFIX}${userId}:${inspectionId}`;
}

export function isRefusedEntriesKey(key: string): boolean {
  return key.startsWith(REFUSED_PREFIX);
}

/**
 * The refused entries kept for this user and inspection; none when there is
 * no record, or one this version cannot read (they are a convenience: the
 * data itself is in the local copy and on the server).
 */
export async function readRefusedEntries(store: KeyValueStore<unknown>, owner: DraftOwner): Promise<StoredRefusedEntry[]> {
  const parsed = RefusedRecordSchema.safeParse(await store.get(refusedEntriesKey(owner)));
  if (!parsed.success || parsed.data.userId !== owner.userId || parsed.data.inspectionId !== owner.inspectionId) return [];
  return parsed.data.entries;
}

/** Keeps the entries (the newest MAX_REFUSED_ENTRIES), or deletes the record when there are none. */
export function writeRefusedEntries(
  store: KeyValueStore<unknown>,
  owner: DraftOwner,
  entries: readonly StoredRefusedEntry[],
  now: number = Date.now(),
): Promise<void> {
  if (entries.length === 0) return store.delete(refusedEntriesKey(owner));
  return store.put(refusedEntriesKey(owner), {
    v: 1,
    userId: owner.userId,
    inspectionId: owner.inspectionId,
    entries: entries.slice(-MAX_REFUSED_ENTRIES),
    changedAt: now,
  });
}

/** Whether a stored record was last changed before `before` (ms), or cannot be read: housekeeping may delete it. */
export function refusedRecordIsOld(raw: unknown, before: number): boolean {
  const parsed = RefusedRecordSchema.safeParse(raw);
  return !parsed.success || parsed.data.changedAt < before;
}
