import { openIndexedDb } from "./idb";
import { createMemoryDatabase, type KeyValueDatabase } from "./kv";

/* ------------------------------------------------------------------ *
 * The capture screen's local database (docs/OFFLINE.md). Bump the version
 * only to add stores; records carry their own format version.
 * ------------------------------------------------------------------ */

export const OFFLINE_DB_NAME = "stericare-offline";
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORES = [
  /** Local copies of inspection data, one per user and inspection (lib/offline/drafts.ts). */
  "drafts",
  /** Upload queue jobs: metadata only, small enough to load at start (lib/photos/upload-queue.ts). */
  "uploads",
  /** The bytes of queued photos, thumbnails and files, read one job at a time. */
  "upload-blobs",
] as const;

export type OfflineStoreName = (typeof OFFLINE_STORES)[number];
export type OfflineDatabase = KeyValueDatabase<OfflineStoreName>;

/**
 * IndexedDB when the browser offers it, otherwise memory (`persistent` is
 * then false, and the screen should say that a reload loses unsynced work).
 */
export async function openOfflineDatabase(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<OfflineDatabase> {
  if (factory) {
    const db = openIndexedDb({ name: OFFLINE_DB_NAME, version: OFFLINE_DB_VERSION, stores: OFFLINE_STORES, factory });
    try {
      await db.ready();
      return db;
    } catch {
      // Private windows in some browsers refuse IndexedDB.
      db.close();
    }
  }
  return createMemoryDatabase(OFFLINE_STORES);
}

let shared: Promise<OfflineDatabase> | null = null;

/** One connection per page, opened on first use. */
export function getOfflineDatabase(): Promise<OfflineDatabase> {
  shared ??= openOfflineDatabase();
  return shared;
}

/**
 * Asks the browser to keep local data under storage pressure (Safari
 * otherwise may evict it after weeks without a visit). Home screen web apps
 * are exempt from that eviction; this covers the browser tab.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = globalThis.navigator?.storage,
): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
