// Words typed and not sent yet: the review's reason for reopening and its
// decisions on AI findings (lib/inspections/review/drafts.ts), and on the
// capture screen an admin's reason for switching a module off and a photo's
// caption. They stay in the tab's sessionStorage until they are sent or
// cancelled, so a reload, a pull to refresh or a tab the iPad dropped and
// loaded again loses nothing typed. Every key names its user: another
// account signed in on the same tab never sees them (as the capture
// screen's landing spot), and where the user is not known (a null key)
// nothing is kept beyond the field. A copy in memory stands in where storage
// is blocked (private browsing), so the fields work all the same, only
// without surviving a reload. The server and hydration see no draft; the
// first render after hydration brings a stored one back
// (useSyncExternalStore), so nothing differs between server and browser.
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Drafts as stored, as JSON
 * ------------------------------------------------------------------ */

/** A stored draft as `schema` reads it; null when there is none or it cannot be read. */
export function parseDraft<T>(schema: z.ZodType<T>, raw: string | null): T | null {
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const TextDraftSchema = z.object({ v: z.literal(1), text: z.string() });

/** The text of one field (a reason, a caption) as typed, an empty one too; null when there is none or it cannot be read. */
export function readTextDraft(raw: string | null): string | null {
  const parsed = parseDraft(TextDraftSchema, raw);
  return parsed ? parsed.text : null;
}

export function writeTextDraft(text: string): string {
  return JSON.stringify({ v: 1, text });
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

/** The storage calls a draft needs: the tab's sessionStorage, or a stand-in in tests. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DraftStore = {
  subscribe(listener: () => void): () => void;
  /** The draft as stored (JSON); null when there is none. */
  get(key: string): string | null;
  /** Keeps a draft, or removes it with null. */
  set(key: string, value: string | null): void;
};

/** A store over `storage` (read when needed: it is null on the server), with a copy in memory. */
export function createDraftStore(storage: () => DraftStorage | null): DraftStore {
  const memory = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(key) {
      if (!memory.has(key)) memory.set(key, readStored(storage(), key));
      return memory.get(key) ?? null;
    },
    set(key, value) {
      if (memory.has(key) && memory.get(key) === value) return;
      memory.set(key, value);
      writeStored(storage(), key, value);
      for (const listener of listeners) listener();
    },
  };
}

function readStored(storage: DraftStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(storage: DraftStorage | null, key: string, value: string | null): void {
  try {
    if (!storage) return;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Full or blocked storage: the copy in memory keeps the field working until the page goes.
  }
}

/** This tab's sessionStorage; null on the server, or where the browser refuses it. */
export function tabStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The drafts in this tab. */
export const tabDrafts: DraftStore = createDraftStore(tabStorage);

/** For a null key: keeps nothing, so the field's own state is the only copy. */
const KEEPS_NOTHING: DraftStore = {
  subscribe: () => () => undefined,
  get: () => null,
  set: () => undefined,
};

/**
 * The draft this tab keeps under `key`: none on the server and during
 * hydration, the stored one after. None for a null key.
 */
export function useStoredDraft<T>(
  key: string | null,
  read: (raw: string | null) => T | null,
  store: DraftStore = tabDrafts,
): T | null {
  const kept = key === null ? KEEPS_NOTHING : store;
  return read(
    useSyncExternalStore(
      kept.subscribe,
      () => (key === null ? null : kept.get(key)),
      () => null,
    ),
  );
}

/**
 * A draft in this tab, for the field that edits it: the stored one once the
 * page has hydrated, then whatever the user types, kept as they type.
 * `update(null)` removes it (cancelled). `forget()` removes the stored copy
 * once it is sent, while the field goes on showing it until the page moves
 * on (the saved result replaces the form). `read` and `write` turn the
 * stored JSON into the draft and back. A null key (the user is not known)
 * keeps the draft in the field only.
 */
export function useTabDraft<T>(
  key: string | null,
  read: (raw: string | null) => T | null,
  write: (value: T) => string,
  store: DraftStore = tabDrafts,
): [value: T | null, update: (value: T | null) => void, forget: () => void] {
  const stored = useStoredDraft(key, read, store);
  // What was typed since, for this key: the field follows the keyboard, not the storage round trip.
  const [typed, setTyped] = useState<{ key: string | null; value: T | null } | null>(null);
  const value = typed !== null && typed.key === key ? typed.value : stored;
  const update = (next: T | null) => {
    setTyped({ key, value: next });
    if (key !== null) store.set(key, next === null ? null : write(next));
  };
  const forget = () => {
    setTyped({ key, value });
    if (key !== null) store.set(key, null);
  };
  return [value, update, forget];
}
