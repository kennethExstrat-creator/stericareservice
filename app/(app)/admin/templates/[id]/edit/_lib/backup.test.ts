// The device copy of unsaved changes (backup.ts): kept per admin and version,
// offered only for the version as it is saved now, never trusted, and never
// an error when storage is missing, full or blocked.
import { describe, expect, it } from "vitest";
import {
  BACKUP_MAX_AGE_MS,
  backupKey,
  foundBackupStore,
  offeredBackup,
  readBackup,
  removeBackup,
  sweepBackups,
  writeBackup,
  type BackupStorage,
  type EditorBackup,
} from "./backup";

/** localStorage in memory, optionally refusing writes as a full or blocked one does. */
function memoryStorage(options: { refuseWrites?: boolean } = {}): BackupStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (options.refuseWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const SAVED = { updatedAt: "2026-10-07T09:12:34.567891+00:00", definition: { code: "E2E", name: "Saved" } };
const NOW = Date.parse("2026-10-07T10:00:00Z");

function backup(overrides: Partial<EditorBackup> = {}): EditorBackup {
  return { v: 1, updatedAt: SAVED.updatedAt, savedAt: NOW, definition: { code: "E2E", name: "Changed" }, ...overrides };
}

describe("device copies of unsaved changes", () => {
  it("are kept per admin and template version", () => {
    expect(backupKey("user-1", "template-1")).toBe("stericare:template-editor:user-1:template-1");
    expect(backupKey("user-2", "template-1")).not.toBe(backupKey("user-1", "template-1"));
  });

  it("write, read back and go", () => {
    const storage = memoryStorage();
    const key = backupKey("user-1", "template-1");
    expect(readBackup(storage, key)).toBeNull();
    expect(writeBackup(storage, key, backup())).toBe(true);
    expect(readBackup(storage, key)).toEqual(backup());
    removeBackup(storage, key);
    expect(readBackup(storage, key)).toBeNull();
  });

  it("never throw: unreadable copies read as none, and refused writes say so", () => {
    const storage = memoryStorage({ refuseWrites: true });
    expect(writeBackup(storage, "k", backup())).toBe(false);
    storage.items.set("k", "{not json");
    expect(readBackup(storage, "k")).toBeNull();
    storage.items.set("k", JSON.stringify({ v: 2, definition: [] }));
    expect(readBackup(storage, "k")).toBeNull();
    const broken: BackupStorage = {
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readBackup(broken, "k")).toBeNull();
    expect(writeBackup(broken, "k", backup())).toBe(false);
    expect(() => removeBackup(broken, "k")).not.toThrow();
    expect(() => sweepBackups(broken, NOW)).not.toThrow();
  });

  it("are offered only for the version as it is saved now, and only when they differ from it", () => {
    expect(offeredBackup(backup(), SAVED)).toEqual(backup());
    expect(offeredBackup(null, SAVED)).toBeNull();
    // Someone saved since: offering it would put their changes back as they were.
    expect(offeredBackup(backup({ updatedAt: "2026-10-07T11:00:00+00:00" }), SAVED)).toBeNull();
    // Nothing unsaved in it.
    expect(offeredBackup(backup({ definition: { name: "Saved", code: "E2E" } }), SAVED)).toBeNull();
  });

  it("older than two weeks, or unreadable, are dropped; other keys are left alone", () => {
    const storage = memoryStorage();
    writeBackup(storage, backupKey("u", "fresh"), backup({ savedAt: NOW - 1000 }));
    writeBackup(storage, backupKey("u", "old"), backup({ savedAt: NOW - BACKUP_MAX_AGE_MS - 1 }));
    storage.items.set(backupKey("u", "broken"), "{");
    storage.items.set("sidebar:collapsed", "true");
    sweepBackups(storage, NOW);
    expect([...storage.items.keys()].sort()).toEqual(["sidebar:collapsed", backupKey("u", "fresh")]);
  });

  it("are read once when the editor opens, and stay until restored or discarded", () => {
    let reads = 0;
    const store = foundBackupStore(() => {
      reads += 1;
      return backup();
    });
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    expect(store.get()).toEqual(backup());
    expect(store.get()).toBe(store.get());
    expect(reads).toBe(1);
    store.dismiss();
    expect(store.get()).toBeNull();
    expect(notified).toBe(1);
    expect(reads).toBe(1);
    unsubscribe();
    store.dismiss();
    expect(notified).toBe(1);
  });
});
