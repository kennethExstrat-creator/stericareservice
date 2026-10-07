// The new-inspection form's draft in the tab (draft.ts): kept per user, never
// an error when storage is missing, blocked or full, brought back only as far
// as the page still offers its choices, and dropped once Create has made the
// inspection. The form itself, reloaded, runs in e2e/new/draft.spec.ts.
import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CLIENT, type PreviousProduct } from "@/lib/inspections/create";
import {
  draftKey,
  foundDraftStore,
  NO_CHOICES,
  readDraft,
  removeDraft,
  restoreChoices,
  rethrowNavigation,
  tabStorage,
  writeDraft,
  type DraftStorage,
  type NewInspectionChoices,
  type OfferedChoices,
} from "./draft";
import { PREVIOUS_SHOWN, type TemplateOption } from "./types";

/** sessionStorage in memory, optionally refusing writes as a full or blocked one does. */
function memoryStorage(options: { refuseWrites?: boolean } = {}): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
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

/** sessionStorage the browser refuses outright, as private browsing can. */
function blockedStorage(): DraftStorage {
  const refuse = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

/** What a call throws; undefined when it returns. */
function thrownBy(call: () => void): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

const CLIENT = "20000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "20000000-0000-4000-8000-000000000002";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const OTHER_MANUFACTURER = "10000000-0000-4000-8000-000000000002";
const KEY = draftKey("user-1");

function product(index: number, extra: Partial<PreviousProduct> = {}): PreviousProduct {
  return {
    inspectionId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    refNo: `INS-2026-${String(index).padStart(4, "0")}`,
    inspectionDate: "2026-09-01",
    status: "submitted",
    clientId: CLIENT,
    manufacturerId: MANUFACTURER,
    productType: "examination",
    productName: `Nitrile ${index}`,
    templateCode: "STD_EG",
    templateVersion: 1,
    copies: {},
    ...extra,
  };
}

function template(index: number, extra: Partial<TemplateOption> = {}): TemplateOption {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    code: `E2E_${index}`,
    version: 1,
    status: "active",
    productType: "examination",
    standard: "EN455",
    clientId: null,
    manufacturerId: null,
    name: `Template ${index}`,
    ready: true,
    unit: "pcs",
    sizes: ["M"],
    sections: [],
    titles: {},
    fieldsOff: {},
    ...extra,
  };
}

const NAMED = product(1);
const UNNAMED = product(2, { productName: null });
const EXAMINATION = template(1);
const SURGICAL = template(2, { productType: "surgical" });
const NOT_READY = template(3, { ready: false });

const OFFERED: OfferedChoices = {
  role: "admin",
  clients: [{ id: CLIENT, label: "Client" }],
  manufacturers: [
    { id: MANUFACTURER, label: "Manufacturer" },
    { id: OTHER_MANUFACTURER, label: "Other manufacturer" },
  ],
  templates: [EXAMINATION, SURGICAL, NOT_READY],
  previous: [NAMED, UNNAMED],
};

/** Everything chosen: the client at the manufacturer, examination gloves, started from the named product. */
const DRAFT: NewInspectionChoices = {
  clientId: CLIENT,
  manufacturerId: MANUFACTURER,
  productType: "examination",
  productName: "Typed before the earlier product was picked",
  previous: NAMED.inspectionId,
  nameFromPrevious: true,
  templateId: EXAMINATION.id,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the new inspection's draft", () => {
  it("is kept per user", () => {
    expect(KEY).toBe("stericare:new-inspection:user-1");
    expect(draftKey("user-2")).not.toBe(KEY);
  });

  it("is written on change, read back and removed", () => {
    const storage = memoryStorage();
    expect(readDraft(storage, KEY)).toBeNull();
    expect(writeDraft(storage, KEY, DRAFT)).toBe(true);
    expect(JSON.parse(storage.items.get(KEY)!)).toEqual({ v: 1, ...DRAFT });
    expect(readDraft(storage, KEY)).toEqual(DRAFT);
    // Another user on the same tab finds nothing.
    expect(readDraft(storage, draftKey("user-2"))).toBeNull();
    removeDraft(storage, KEY);
    expect(readDraft(storage, KEY)).toBeNull();
  });

  it("reads a draft without the start-from-previous name or an admin's template as neither", () => {
    const storage = memoryStorage();
    const { clientId, manufacturerId, productType, productName, previous } = DRAFT;
    storage.items.set(KEY, JSON.stringify({ v: 1, clientId, manufacturerId, productType, productName, previous }));
    expect(readDraft(storage, KEY)).toEqual({ ...DRAFT, nameFromPrevious: false, templateId: "" });
  });

  it("never throws: unreadable drafts read as none, and refused writes say so", () => {
    const full = memoryStorage({ refuseWrites: true });
    expect(writeDraft(full, KEY, DRAFT)).toBe(false);
    const storage = memoryStorage();
    for (const raw of ["{not json", JSON.stringify({ ...DRAFT, v: 2 }), JSON.stringify({ ...DRAFT, v: 1, productType: "gloves" })]) {
      storage.items.set(KEY, raw);
      expect(readDraft(storage, KEY), raw).toBeNull();
    }
    const blocked = blockedStorage();
    expect(readDraft(blocked, KEY)).toBeNull();
    expect(writeDraft(blocked, KEY, DRAFT)).toBe(false);
    expect(() => removeDraft(blocked, KEY)).not.toThrow();
    // No storage at all: the server, or a browser that refuses it.
    expect(readDraft(null, KEY)).toBeNull();
    expect(writeDraft(null, KEY, DRAFT)).toBe(false);
    expect(() => removeDraft(null, KEY)).not.toThrow();
  });

  it("lives in the tab's sessionStorage: none on the server, none where the browser refuses it", () => {
    expect(tabStorage()).toBeNull();
    const storage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    expect(tabStorage()).toBe(storage);
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(tabStorage()).toBeNull();
  });

  it("is read once when the form opens, and stays the same from then on", () => {
    let reads = 0;
    const store = foundDraftStore(() => {
      reads += 1;
      return DRAFT;
    });
    const unsubscribe = store.subscribe();
    expect(store.get()).toEqual(DRAFT);
    expect(store.get()).toBe(store.get());
    expect(reads).toBe(1);
    expect(() => unsubscribe()).not.toThrow();
    expect(foundDraftStore(() => null).get()).toBeNull();
  });
});

describe("an error Create caught", () => {
  // What the Server Action throws once the inspection exists: redirect() to it.
  const created = thrownBy(() => redirect("/inspections/30000000-0000-4000-8000-000000000099"));

  it("the redirect to the new inspection: the draft goes, and the redirect is thrown on for Next.js", () => {
    expect(created).toBeInstanceOf(Error);
    const storage = memoryStorage();
    writeDraft(storage, KEY, DRAFT);
    writeDraft(storage, draftKey("user-2"), NO_CHOICES);
    expect(thrownBy(() => rethrowNavigation(created, storage, KEY))).toBe(created);
    expect(readDraft(storage, KEY)).toBeNull();
    // Another user's draft in the tab stays.
    expect(readDraft(storage, draftKey("user-2"))).toEqual(NO_CHOICES);
    // Storage that refuses still lets Next.js follow the redirect.
    expect(thrownBy(() => rethrowNavigation(created, blockedStorage(), KEY))).toBe(created);
    expect(thrownBy(() => rethrowNavigation(created, null, KEY))).toBe(created);
  });

  it("anything else, such as the server not reached: the draft stays for another try", () => {
    const storage = memoryStorage();
    writeDraft(storage, KEY, DRAFT);
    expect(thrownBy(() => rethrowNavigation(new TypeError("Failed to fetch"), storage, KEY))).toBeUndefined();
    expect(readDraft(storage, KEY)).toEqual(DRAFT);
  });
});

describe("a draft brought back", () => {
  it("keeps every choice the page still offers, the typed name with it", () => {
    expect(restoreChoices(DRAFT, OFFERED)).toEqual(DRAFT);
    const noClient = { ...DRAFT, clientId: NO_CLIENT, previous: "", nameFromPrevious: false };
    expect(restoreChoices(noClient, { ...OFFERED, clients: [] })).toEqual(noClient);
    expect(restoreChoices(NO_CHOICES, OFFERED)).toEqual(NO_CHOICES);
  });

  it("leaves out a client or manufacturer the page no longer offers, and the earlier inspection with it", () => {
    expect(restoreChoices({ ...DRAFT, clientId: OTHER_CLIENT }, OFFERED)).toMatchObject({
      clientId: "",
      manufacturerId: MANUFACTURER,
      previous: "",
      nameFromPrevious: false,
      productName: DRAFT.productName,
    });
    expect(restoreChoices(DRAFT, { ...OFFERED, manufacturers: [] })).toMatchObject({
      clientId: CLIENT,
      manufacturerId: "",
      previous: "",
      nameFromPrevious: false,
    });
  });

  it("starts from an earlier inspection only while the picker lists it for these picks", () => {
    // Gone from the list (deleted, or no longer visible).
    expect(restoreChoices(DRAFT, { ...OFFERED, previous: [UNNAMED] })).toMatchObject({ previous: "", nameFromPrevious: false });
    // Listed for another manufacturer than the one chosen.
    expect(restoreChoices({ ...DRAFT, manufacturerId: OTHER_MANUFACTURER }, OFFERED)).toMatchObject({
      manufacturerId: OTHER_MANUFACTURER,
      previous: "",
    });
    // No product type chosen: nothing is listed yet.
    expect(restoreChoices({ ...DRAFT, productType: null }, OFFERED)).toMatchObject({ previous: "", templateId: "" });
    // Newer products pushed it past the most recent the picker lists: it would be copied unseen.
    const newer = Array.from({ length: PREVIOUS_SHOWN }, (_, index) => product(100 + index));
    expect(restoreChoices(DRAFT, { ...OFFERED, previous: [...newer, NAMED] })).toMatchObject({ previous: "" });
    expect(restoreChoices(DRAFT, { ...OFFERED, previous: [...newer.slice(1), NAMED] })).toMatchObject({
      previous: NAMED.inspectionId,
    });
  });

  it("fills the product name from an earlier inspection only when it has one", () => {
    expect(restoreChoices({ ...DRAFT, previous: UNNAMED.inspectionId }, OFFERED)).toMatchObject({
      previous: UNNAMED.inspectionId,
      nameFromPrevious: false,
    });
    // Edited after the pick: the typed name stays.
    expect(restoreChoices({ ...DRAFT, nameFromPrevious: false }, OFFERED)).toMatchObject({
      previous: NAMED.inspectionId,
      nameFromPrevious: false,
    });
  });

  it("keeps an admin's template only while they can still choose it for the product type", () => {
    expect(restoreChoices(DRAFT, { ...OFFERED, role: "inspector" })).toMatchObject({ templateId: "" });
    expect(restoreChoices({ ...DRAFT, templateId: SURGICAL.id }, OFFERED)).toMatchObject({ templateId: "" });
    expect(restoreChoices({ ...DRAFT, productType: "surgical", templateId: SURGICAL.id }, OFFERED)).toMatchObject({
      templateId: SURGICAL.id,
    });
    expect(restoreChoices({ ...DRAFT, templateId: NOT_READY.id }, OFFERED)).toMatchObject({ templateId: "" });
    expect(restoreChoices(DRAFT, { ...OFFERED, templates: [SURGICAL] })).toMatchObject({ templateId: "" });
  });
});
