// Words typed on the review and not sent yet: the reason for reopening an
// inspection, and a decision on an AI finding with its note. They stay in
// the tab's sessionStorage until they are sent or cancelled, so a reload, a
// pull to refresh or a tab the iPad dropped and loaded again loses nothing
// typed. Per user: another account signed in on the same tab never sees
// them (as the capture screen's landing spot). A copy in memory stands in
// where storage is blocked (private browsing), so the fields work all the
// same, only without surviving a reload. The server and hydration see no
// draft; the first render after hydration brings a stored one back
// (useSyncExternalStore), so nothing differs between server and browser.
import { useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { AiReviewActionKindSchema } from "@/lib/schemas/ai-review";

const PREFIX = "stericare:review-draft:";

/** The reason an admin is writing for reopening this inspection. */
export function reopenDraftKey(userId: string, inspectionId: string): string {
  return `${PREFIX}reopen:${userId}:${inspectionId}`;
}

/** An admin's half-made decision on one finding of one second opinion: finding ids repeat from one opinion to the next. */
export function decisionDraftKey(userId: string, reviewId: string, findingId: string): string {
  return `${PREFIX}ai-decision:${userId}:${reviewId}:${encodeURIComponent(findingId)}`;
}

/* ------------------------------------------------------------------ *
 * The drafts' shapes, stored as JSON
 * ------------------------------------------------------------------ */

const ReopenDraftSchema = z.object({ v: z.literal(1), reason: z.string() });

/** The reason as typed; null when there is none or it cannot be read. */
export function readReopenDraft(raw: string | null): string | null {
  const parsed = parseJson(ReopenDraftSchema, raw);
  return parsed ? parsed.reason : null;
}

export function writeReopenDraft(reason: string): string {
  return JSON.stringify({ v: 1, reason });
}

const DecisionDraftSchema = z.object({
  v: z.literal(1),
  /** Empty until a decision is chosen: a note can come first. */
  action: z.union([AiReviewActionKindSchema, z.literal("")]),
  note: z.string(),
});

export type DecisionDraft = Omit<z.infer<typeof DecisionDraftSchema>, "v">;

export function readDecisionDraft(raw: string | null): DecisionDraft | null {
  const parsed = parseJson(DecisionDraftSchema, raw);
  return parsed ? { action: parsed.action, note: parsed.note } : null;
}

export function writeDecisionDraft(draft: DecisionDraft): string {
  return JSON.stringify({ v: 1, action: draft.action, note: draft.note });
}

function parseJson<T>(schema: z.ZodType<T>, raw: string | null): T | null {
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

/** The review's drafts in this tab. */
export const reviewDrafts: DraftStore = createDraftStore(tabStorage);

/** The draft this tab keeps under `key`: none on the server and during hydration, the stored one after. */
export function useStoredDraft<T>(
  key: string,
  read: (raw: string | null) => T | null,
  store: DraftStore = reviewDrafts,
): T | null {
  return read(
    useSyncExternalStore(
      store.subscribe,
      () => store.get(key),
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
 * stored JSON into the draft and back.
 */
export function useTabDraft<T>(
  key: string,
  read: (raw: string | null) => T | null,
  write: (value: T) => string,
  store: DraftStore = reviewDrafts,
): [value: T | null, update: (value: T | null) => void, forget: () => void] {
  const stored = useStoredDraft(key, read, store);
  // What was typed since, for this key: the field follows the keyboard, not the storage round trip.
  const [typed, setTyped] = useState<{ key: string; value: T | null } | null>(null);
  const value = typed !== null && typed.key === key ? typed.value : stored;
  const update = (next: T | null) => {
    setTyped({ key, value: next });
    store.set(key, next === null ? null : write(next));
  };
  const forget = () => {
    setTyped({ key, value });
    store.set(key, null);
  };
  return [value, update, forget];
}
