import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDraftStore,
  readTextDraft,
  tabStorage,
  useTabDraft,
  writeTextDraft,
  type DraftStorage,
  type DraftStore,
} from "./tab-draft";

/** A sessionStorage stand-in. */
function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** What useTabDraft hands a field as the server renders it. Its update and forget still reach the store. */
function serverDraft(key: string | null, store: DraftStore) {
  let draft: ReturnType<typeof useTabDraft<string>> | undefined;
  function Field() {
    draft = useTabDraft(key, readTextDraft, writeTextDraft, store);
    return null;
  }
  renderToStaticMarkup(<Field />);
  if (!draft) throw new Error("not rendered");
  return draft;
}

describe("text drafts as stored", () => {
  it("round-trip a field's text as typed, lines and an empty text too", () => {
    const reason = "Not part of this client's order.\nAsked on site.";
    expect(readTextDraft(writeTextDraft(reason))).toBe(reason);
    // A caption cleared on purpose is a draft of its own, not none.
    expect(readTextDraft(writeTextDraft(""))).toBe("");
  });

  it("read anything else as no draft", () => {
    expect(readTextDraft(null)).toBeNull();
    expect(readTextDraft("not json")).toBeNull();
    expect(readTextDraft(JSON.stringify({ v: 2, text: "later format" }))).toBeNull();
    expect(readTextDraft(JSON.stringify({ v: 1, reason: "the review's shape" }))).toBeNull();
  });
});

describe("createDraftStore", () => {
  it("keeps a draft in the tab's storage, and tells its readers when it changes", () => {
    const storage = memoryStorage();
    const store = createDraftStore(() => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set("a", writeTextDraft("Recheck the carton labels."));
    expect(storage.items.get("a")).toBe(writeTextDraft("Recheck the carton labels."));
    expect(listener).toHaveBeenCalledTimes(1);
    // The same value again changes nothing.
    store.set("a", writeTextDraft("Recheck the carton labels."));
    expect(listener).toHaveBeenCalledTimes(1);

    store.set("a", null);
    expect(storage.items.has("a")).toBe(false);
    expect(store.get("a")).toBeNull();
    unsubscribe();
    store.set("a", "x");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("brings back what a page loaded before it stored: a reload", () => {
    const storage = memoryStorage({ b: writeTextDraft("Typed before the reload.") });
    const afterReload = createDraftStore(() => storage);
    expect(readTextDraft(afterReload.get("b"))).toBe("Typed before the reload.");
  });

  it("works from memory where the browser refuses storage, and on the server", () => {
    const refusing: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const blocked = createDraftStore(() => refusing);
    expect(blocked.get("c")).toBeNull();
    blocked.set("c", "kept in memory");
    expect(blocked.get("c")).toBe("kept in memory");

    const server = createDraftStore(() => null);
    server.set("d", "y");
    expect(server.get("d")).toBe("y");
    // No window here: the server has no tab storage.
    expect(tabStorage()).toBeNull();
  });
});

describe("useTabDraft", () => {
  it("shows no draft on the server, so hydration matches, whatever the tab keeps", () => {
    const store = createDraftStore(() => memoryStorage({ k: writeTextDraft("Kept in the tab.") }));
    const [value] = serverDraft("k", store);
    expect(value).toBeNull();
  });

  it("keeps what is typed under its key, and lets it go when cancelled or sent", () => {
    const storage = memoryStorage();
    const store = createDraftStore(() => storage);
    const [, update, forget] = serverDraft("k", store);
    update("Typed");
    expect(readTextDraft(storage.items.get("k") ?? null)).toBe("Typed");
    update(null);
    expect(storage.items.has("k")).toBe(false);
    update("Typed again");
    forget();
    expect(storage.items.has("k")).toBe(false);
  });

  it("keeps nothing for a null key: a user who is not known leaves no draft behind", () => {
    const storage = memoryStorage();
    const store = createDraftStore(() => storage);
    const [value, update, forget] = serverDraft(null, store);
    expect(value).toBeNull();
    update("Typed without a user");
    forget();
    expect(storage.items.size).toBe(0);
  });
});
