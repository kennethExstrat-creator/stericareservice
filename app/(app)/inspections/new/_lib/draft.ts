// What the new-inspection form holds before Create: the client, manufacturer
// and product type, the product name as typed, the earlier inspection to
// start from and an admin's choice of template. It is kept in the tab's
// sessionStorage on every change, so a reload, a pull to refresh or a tab
// the iPad dropped and loaded again loses nothing, and removed once the
// inspection is created or the form is cancelled. Per user: another account
// signed in on the same tab never sees it. The Source Documents held on the
// form are not part of it: files cannot be kept there, and leaving the page
// drops them.
//
// The server and hydration see no draft; the first render after hydration
// brings it back (useSyncExternalStore), so nothing differs between server
// and browser. Whatever the page no longer offers (a client deleted since, an
// earlier inspection that left the list) is left out. The draft is a
// convenience, never the record: storage can be blocked (private browsing),
// full or wiped, and every access here is allowed to fail.
import { z } from "zod";
import { NO_CLIENT, previousFor } from "@/lib/inspections/create";
import { ProductTypeSchema, type ProductType } from "@/lib/schemas/common";
import { PREVIOUS_SHOWN, type Option, type PreviousProduct, type TemplateOption } from "./types";

const PREFIX = "stericare:new-inspection:";

/** One draft per user in the tab. */
export function draftKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** The form's choices as its pickers hold them: "" is nothing chosen yet. */
export type NewInspectionChoices = {
  /** A client's id, NO_CLIENT, or "". */
  clientId: string;
  manufacturerId: string;
  productType: ProductType | null;
  /** The product name as the user typed it. */
  productName: string;
  /** The earlier inspection to start from; "" starts blank. */
  previous: string;
  /** The earlier inspection's product name fills the field, until the user edits it. */
  nameFromPrevious: boolean;
  /** An admin's choice of template; "" leaves it to the rule. */
  templateId: string;
};

export const NO_CHOICES: NewInspectionChoices = {
  clientId: "",
  manufacturerId: "",
  productType: null,
  productName: "",
  previous: "",
  nameFromPrevious: false,
  templateId: "",
};

const DraftSchema = z.object({
  v: z.literal(1),
  clientId: z.string(),
  manufacturerId: z.string(),
  productType: ProductTypeSchema.nullable(),
  productName: z.string(),
  previous: z.string(),
  nameFromPrevious: z.boolean().default(false),
  templateId: z.string().default(""),
});

/** The storage calls a draft needs: the tab's sessionStorage, or a stand-in in tests. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This tab's sessionStorage; null on the server, or where the browser refuses it. */
export function tabStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The draft kept under `key`; null when there is none, or it cannot be read. */
export function readDraft(storage: DraftStorage | null, key: string): NewInspectionChoices | null {
  try {
    const raw = storage?.getItem(key) ?? null;
    if (raw === null) return null;
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { clientId, manufacturerId, productType, productName, previous, nameFromPrevious, templateId } = parsed.data;
    return { clientId, manufacturerId, productType, productName, previous, nameFromPrevious, templateId };
  } catch {
    return null;
  }
}

/** Keeps the choices; false when the tab would not take them (blocked or full storage). */
export function writeDraft(storage: DraftStorage | null, key: string, choices: NewInspectionChoices): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify({ v: 1, ...choices }));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do: the tab's storage goes with the tab.
  }
}

/** What the page offers now. */
export type OfferedChoices = {
  role: "inspector" | "admin";
  clients: readonly Option[];
  manufacturers: readonly Option[];
  templates: readonly TemplateOption[];
  /** The latest inspection of each product the user can see. */
  previous: readonly PreviousProduct[];
};

/**
 * A draft's choices as far as the page still offers them; anything else is
 * not chosen. The earlier inspection must still be listed for the client,
 * manufacturer and product type (the picker lists the most recent few), and
 * an admin's template must still be one they can choose for the product type.
 */
export function restoreChoices(draft: NewInspectionChoices, offered: OfferedChoices): NewInspectionChoices {
  const clientId =
    draft.clientId === NO_CLIENT || offered.clients.some((client) => client.id === draft.clientId) ? draft.clientId : "";
  const manufacturerId = offered.manufacturers.some((manufacturer) => manufacturer.id === draft.manufacturerId)
    ? draft.manufacturerId
    : "";
  const { productType } = draft;
  const client = clientId === "" ? undefined : clientId === NO_CLIENT ? null : clientId;
  const listed =
    client !== undefined && manufacturerId !== "" && productType !== null
      ? previousFor(offered.previous, { clientId: client, manufacturerId, productType }).slice(0, PREVIOUS_SHOWN)
      : [];
  const product = listed.find((entry) => entry.inspectionId === draft.previous) ?? null;
  const templateId =
    offered.role === "admin" &&
    offered.templates.some(
      (template) => template.id === draft.templateId && template.productType === productType && template.ready,
    )
      ? draft.templateId
      : "";
  return {
    clientId,
    manufacturerId,
    productType,
    productName: draft.productName,
    previous: product?.inspectionId ?? "",
    nameFromPrevious: draft.nameFromPrevious && product !== null && product.productName !== null,
    templateId,
  };
}

/**
 * The draft found when the form opened, as an external store for
 * useSyncExternalStore: read once, on the client (the server and hydration
 * see none). The form keeps the choices itself from the first change on.
 */
export function foundDraftStore(read: () => NewInspectionChoices | null) {
  let found: NewInspectionChoices | null | undefined;
  return {
    subscribe(): () => void {
      // The draft found never changes: the form takes over from it.
      return () => {};
    },
    get(): NewInspectionChoices | null {
      if (found === undefined) found = read();
      return found;
    },
  };
}
