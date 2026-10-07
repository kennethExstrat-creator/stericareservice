import { describe, expect, it, vi } from "vitest";
import {
  createDraftStore,
  decisionDraftKey,
  readDecisionDraft,
  readReopenDraft,
  reopenDraftKey,
  tabStorage,
  writeDecisionDraft,
  writeReopenDraft,
  type DraftStorage,
} from "./drafts";

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

const ADMIN = "00000000-0000-4000-8000-000000000102";
const OTHER_ADMIN = "00000000-0000-4000-8000-000000000103";
const INSPECTION = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const REVIEW = "99999999-9999-4999-8999-000000000001";
const NEWER_REVIEW = "99999999-9999-4999-8999-000000000002";

describe("draft keys", () => {
  it("keep each admin's drafts apart, per inspection, and per opinion and finding", () => {
    expect(reopenDraftKey(ADMIN, INSPECTION)).not.toBe(reopenDraftKey(OTHER_ADMIN, INSPECTION));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(ADMIN, NEWER_REVIEW, "F1"));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(ADMIN, REVIEW, "F2"));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(OTHER_ADMIN, REVIEW, "F1"));
  });
});

describe("drafts as stored", () => {
  it("round-trip the reason and the decision with its note", () => {
    const reason = "Size M watertight: retest the two burst gloves.\nAdd the photos.";
    expect(readReopenDraft(writeReopenDraft(reason))).toBe(reason);
    const decision = { action: "disagree" as const, note: "Checked on site." };
    expect(readDecisionDraft(writeDecisionDraft(decision))).toEqual(decision);
    // A note typed before a choice.
    expect(readDecisionDraft(writeDecisionDraft({ action: "", note: "First thoughts" }))).toEqual({ action: "", note: "First thoughts" });
  });

  it("read anything else as no draft", () => {
    expect(readReopenDraft(null)).toBeNull();
    expect(readReopenDraft("not json")).toBeNull();
    expect(readReopenDraft(JSON.stringify({ v: 2, reason: "later format" }))).toBeNull();
    expect(readDecisionDraft(JSON.stringify({ v: 1, action: "ignore", note: "" }))).toBeNull();
  });
});

describe("createDraftStore", () => {
  it("keeps a draft in the tab's storage, and tells its readers when it changes", () => {
    const storage = memoryStorage();
    const store = createDraftStore(() => storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set("a", writeReopenDraft("Recheck the carton labels."));
    expect(storage.items.get("a")).toBe(writeReopenDraft("Recheck the carton labels."));
    expect(listener).toHaveBeenCalledTimes(1);
    // The same value again changes nothing.
    store.set("a", writeReopenDraft("Recheck the carton labels."));
    expect(listener).toHaveBeenCalledTimes(1);

    store.set("a", null);
    expect(storage.items.has("a")).toBe(false);
    expect(store.get("a")).toBeNull();
    unsubscribe();
    store.set("a", "x");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("brings back what a page loaded before it stored: a reload", () => {
    const storage = memoryStorage({ b: writeReopenDraft("Typed before the reload.") });
    const afterReload = createDraftStore(() => storage);
    expect(readReopenDraft(afterReload.get("b"))).toBe("Typed before the reload.");
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
