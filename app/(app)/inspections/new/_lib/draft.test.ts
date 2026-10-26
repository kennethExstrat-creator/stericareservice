// The new-inspection form's draft in the tab (draft.ts): kept per user, never
// an error when storage is missing, blocked or full, brought back only as far
// as the page still offers its choices, and dropped once Create has made the
// inspection. The form itself, reloaded, runs in e2e/new/draft.spec.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CLIENT } from "@/lib/inspections/create";
import {
  draftKey,
  foundDraftStore,
  NO_CHOICES,
  readDraft,
  removeDraft,
  restoreChoices,
  tabStorage,
  writeDraft,
  type DraftStorage,
  type NewInspectionChoices,
  type OfferedChoices,
} from "./draft";
import type { TemplateOption } from "./types";

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

const CLIENT = "20000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "20000000-0000-4000-8000-000000000002";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const OTHER_MANUFACTURER = "10000000-0000-4000-8000-000000000002";
const KEY = draftKey("user-1");

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
    fieldsOff: {},
    ...extra,
  };
}

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
};

/** Everything chosen: the client at the manufacturer, examination gloves, a typed name and an admin's template. */
const DRAFT: NewInspectionChoices = {
  clientId: CLIENT,
  manufacturerId: MANUFACTURER,
  productType: "examination",
  productName: "Typed before the reload",
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

  it("reads a draft without an admin's template as none", () => {
    const storage = memoryStorage();
    const { clientId, manufacturerId, productType, productName } = DRAFT;
    storage.items.set(KEY, JSON.stringify({ v: 1, clientId, manufacturerId, productType, productName }));
    expect(readDraft(storage, KEY)).toEqual({ ...DRAFT, templateId: "" });
  });

  it("reads a draft kept with Start From Previous as its other choices, and writes it back without the earlier inspection", () => {
    // Kept before Start From Previous went (Kenneth, 26 October 2026): it names the earlier inspection.
    const storage = memoryStorage();
    const earlier = "30000000-0000-4000-8000-000000000001";
    storage.items.set(KEY, JSON.stringify({ v: 1, ...DRAFT, previous: earlier, nameFromPrevious: true }));
    const found = readDraft(storage, KEY);
    expect(found).toStrictEqual(DRAFT);
    expect(restoreChoices(found!, OFFERED)).toStrictEqual(DRAFT);
    // Older still: no admin's template, and no name from the earlier inspection.
    const { clientId, manufacturerId, productType, productName } = DRAFT;
    storage.items.set(KEY, JSON.stringify({ v: 1, clientId, manufacturerId, productType, productName, previous: earlier }));
    expect(readDraft(storage, KEY)).toStrictEqual({ ...DRAFT, templateId: "" });
    // The next change keeps the draft without them.
    expect(writeDraft(storage, KEY, { ...found!, productName: "Edited after the reload" })).toBe(true);
    expect(JSON.parse(storage.items.get(KEY)!)).toStrictEqual({ v: 1, ...DRAFT, productName: "Edited after the reload" });
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

describe("a draft brought back", () => {
  it("keeps every choice the page still offers, the typed name with it", () => {
    expect(restoreChoices(DRAFT, OFFERED)).toEqual(DRAFT);
    const noClient = { ...DRAFT, clientId: NO_CLIENT };
    expect(restoreChoices(noClient, { ...OFFERED, clients: [] })).toEqual(noClient);
    const otherManufacturer = { ...DRAFT, manufacturerId: OTHER_MANUFACTURER };
    expect(restoreChoices(otherManufacturer, OFFERED)).toEqual(otherManufacturer);
    expect(restoreChoices(NO_CHOICES, OFFERED)).toEqual(NO_CHOICES);
  });

  it("leaves out a client or manufacturer the page no longer offers", () => {
    expect(restoreChoices({ ...DRAFT, clientId: OTHER_CLIENT }, OFFERED)).toMatchObject({
      clientId: "",
      manufacturerId: MANUFACTURER,
      productName: DRAFT.productName,
    });
    expect(restoreChoices(DRAFT, { ...OFFERED, manufacturers: [] })).toMatchObject({
      clientId: CLIENT,
      manufacturerId: "",
      productName: DRAFT.productName,
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
    // No product type chosen: no template is for it yet.
    expect(restoreChoices({ ...DRAFT, productType: null }, OFFERED)).toMatchObject({ productType: null, templateId: "" });
  });
});
