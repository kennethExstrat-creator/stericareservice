// A copy of the editor's unsaved changes on this device, so a reload, a
// closed tab or an iPad that dropped the page in the background loses
// nothing: the editor offers the copy back when the version opens again.
// One copy per admin and template version, kept while there are unsaved
// changes and removed once they are saved, discarded or left on purpose.
//
// Only a copy of the version as it is saved now is offered: one made before
// someone else saved would put their changes back as they were. The copy is
// a convenience, never the record: storage can be full, blocked or wiped,
// and every access here is allowed to fail.
import { z } from "zod";
import { deepEqual } from "@/lib/zod-form";

const PREFIX = "stericare:template-editor:";

/** Copies older than this are dropped when the editor opens. */
export const BACKUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const BackupSchema = z.object({
  v: z.literal(1),
  /** The saved version the changes were made on (templates.updated_at). */
  updatedAt: z.string(),
  /** When the copy was made, in ms since 1970. */
  savedAt: z.number(),
  definition: z.record(z.string(), z.unknown()),
});

export type EditorBackup = z.infer<typeof BackupSchema>;

/** The storage calls a backup needs: window.localStorage, or a stand-in in tests. */
export type BackupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** One key per admin and template version: another admin on the same device never sees it. */
export function backupKey(userId: string, templateId: string): string {
  return `${PREFIX}${userId}:${templateId}`;
}

/** This device's storage, or null where there is none (the server, a blocked or private window). */
export function deviceStorage(): BackupStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readBackup(storage: BackupStorage, key: string): EditorBackup | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = BackupSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keeps a copy; false when the device would not take it (full or blocked storage). */
export function writeBackup(storage: BackupStorage, key: string, backup: EditorBackup): boolean {
  try {
    storage.setItem(key, JSON.stringify(backup));
    return true;
  } catch {
    return false;
  }
}

export function removeBackup(storage: BackupStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do: a copy that stays is never offered for another saved version.
  }
}

/**
 * The copy to offer when a version opens: made on the version as it is saved
 * now, and different from it. Anything else is of no use any more.
 */
export function offeredBackup(
  backup: EditorBackup | null,
  saved: { updatedAt: string; definition: unknown },
): EditorBackup | null {
  if (backup === null || backup.updatedAt !== saved.updatedAt) return null;
  return deepEqual(backup.definition, saved.definition) ? null : backup;
}

/** Drops this editor's copies that are too old or unreadable, for every template and admin on the device. */
export function sweepBackups(storage: BackupStorage, now: number): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const backup = readBackup(storage, key);
      if (backup === null || now - backup.savedAt > BACKUP_MAX_AGE_MS) removeBackup(storage, key);
    }
  } catch {
    // A device that will not list its storage keeps its copies until they are replaced.
  }
}

/**
 * The copy found when the editor opened, as an external store for
 * useSyncExternalStore: read once, on the client (the server and hydration
 * see none), then kept until the admin restores or discards it.
 */
export function foundBackupStore(read: () => EditorBackup | null) {
  let found: EditorBackup | null | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(): EditorBackup | null {
      if (found === undefined) found = read();
      return found;
    },
    dismiss() {
      found = null;
      for (const listener of listeners) listener();
    },
  };
}
