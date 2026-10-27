// Filling a new inspection from an order document (docs/AI.md, "Reading order
// documents"). Pure: what Claude read is checked here before anything is
// filled in, and the fill goes only into fields that are still empty, so a
// document never overwrites what the inspector or "start from previous" set.
import { LIMITS } from "@/lib/admin/reference";
import { IsoDateSchema } from "@/lib/schemas/common";
import type {
  DocumentFill,
  DocumentFormFields,
  DocumentHeaderField,
  DocumentReading,
  ListedMatch,
  ManufacturerDetails,
} from "@/lib/schemas/document-fill";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { normaliseSize } from "@/lib/sizes";
import { readModuleEntry, writeModuleData, type InspectionData } from "@/modules/_framework/data";
import { HeaderDataSchema } from "@/modules/header/schema";
import { emptyOrderLine, OrderLotsDataSchema } from "@/modules/order_lots/schema";
import { PRODUCT_NAME_MAX, templateShowsField } from "./create";
import { directoryOptions, findByName, manufacturerDraft, planManufacturer, type ManufacturerDirectory } from "./reference-match";

type Listed = readonly { id: string; name: string }[];

/** Trimmed, spaces collapsed, at most `max` characters; null when empty. */
function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text === "" ? null : text;
}

/** An address: each line cleaned, blank lines out, at most `max` characters; null when empty. */
function cleanLines(value: string, max: number): string | null {
  const text = value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, max)
    .trim();
  return text === "" ? null : text;
}

function date(value: string | null): string | null {
  const text = clean(value, 10);
  return text && IsoDateSchema.safeParse(text).success ? text : null;
}

/**
 * The listed client a reading names: the id Steri-AI gave, from the list it
 * was offered; else the one whose name reads the same as the name printed
 * (case, punctuation, spacing and legal suffixes aside), which it missed.
 */
function listedClient(id: string | null, name: string | null, clients: Listed): { id: string; match: ListedMatch } | null {
  const chosen = id ? clients.find((entry) => entry.id === id) : undefined;
  if (chosen) return { id: chosen.id, match: { label: chosen.name, by: "steri_ai" } };
  const found = name ? findByName(name, clients, (entry) => entry.name) : null;
  return found?.kind === "one" ? { id: found.entry.id, match: { label: found.entry.name, by: "name" } } : null;
}

/** The parts of the manufacturer a document prints; null when it prints none of them. */
function printedDetails(details: DocumentReading["manufacturerDetails"]): ManufacturerDetails | null {
  const parts: ManufacturerDetails = {
    brand: clean(details.brand, LIMITS.name),
    company: clean(details.company, LIMITS.name),
    factory: clean(details.factory, LIMITS.factory_name),
    address: cleanLines(details.address, LIMITS.address),
    country: clean(details.country, LIMITS.country),
  };
  return Object.values(parts).some((part) => part !== null) ? parts : null;
}

/**
 * The listed factory a reading names: the id Steri-AI gave, from the list;
 * else the factory New Manufacturer would find listed for what the document
 * prints (lib/inspections/reference-match.ts), which it missed.
 */
function listedFactory(
  id: string | null,
  details: ManufacturerDetails | null,
  printed: string | null,
  directory: ManufacturerDirectory,
): { id: string; match: ListedMatch } | null {
  const label = (factoryId: string) => directoryOptions(directory).find((option) => option.id === factoryId)?.label ?? "";
  if (id && directory.factories.some((factory) => factory.id === id)) return { id, match: { label: label(id), by: "steri_ai" } };
  const draft = manufacturerDraft(details, printed);
  if (draft.company === "") return null;
  const plan = planManufacturer({ brand: draft.brand, company: draft.company, factory: draft.factory || null }, directory);
  return plan.kind === "listed" ? { id: plan.factoryId, match: { label: label(plan.factoryId), by: "name" } } : null;
}

/**
 * What the form may use from Claude's answer: ids only from the lists the
 * user was offered (or found there by name), dates that are real dates,
 * sizes the app knows (lines of one size added up), lots trimmed and once
 * each, and what it printed about a manufacturer no entry matches.
 */
export function checkReading(
  reading: DocumentReading,
  lists: { clients: Listed; directory: ManufacturerDirectory },
  fileName: string,
): { form: DocumentFormFields; fill: DocumentFill; notes: string | null } {
  const clientName = clean(reading.clientName, 200);
  const manufacturerName = clean(reading.manufacturerName, 200);
  const client = listedClient(reading.clientId, clientName, lists.clients);
  const details = printedDetails(reading.manufacturerDetails);
  const manufacturer = listedFactory(reading.manufacturerId, details, manufacturerName, lists.directory);

  const sizes: DocumentFill["sizes"] = {};
  for (const line of reading.sizes) {
    const size = normaliseSize(line.size);
    if (!size) continue;
    const current = sizes[size] ?? { qtyCases: null, lotNumbers: [] };
    const qty = line.qtyCases !== null && Number.isInteger(line.qtyCases) && line.qtyCases >= 0 ? line.qtyCases : null;
    const lots = line.lotNumbers.map((lot) => clean(lot, 200)).filter((lot): lot is string => lot !== null);
    sizes[size] = {
      qtyCases: qty === null ? current.qtyCases : Math.min((current.qtyCases ?? 0) + qty, 1_000_000),
      lotNumbers: [...new Set([...current.lotNumbers, ...lots])].slice(0, 50),
    };
  }

  return {
    form: {
      clientId: client?.id ?? null,
      clientName,
      clientMatch: client?.match ?? null,
      manufacturerId: manufacturer?.id ?? null,
      manufacturerName,
      manufacturerMatch: manufacturer?.match ?? null,
      manufacturerDetails: manufacturer ? null : details,
      productType: reading.productType,
      productName: clean(reading.productName, PRODUCT_NAME_MAX),
    },
    fill: {
      fileName: fileName.slice(0, 255),
      header: {
        poNo: clean(reading.poNo, 2000),
        productCode: clean(reading.productCode, 2000),
        factoryGloveCode: clean(reading.factoryGloveCode, 2000),
        inspectionDate: date(reading.inspectionDate),
        mfgDate: date(reading.mfgDate),
        expiryDate: date(reading.expiryDate),
      },
      sizes,
    },
    notes: clean(reading.notes, 600),
  };
}

const HEADER_FIELDS = ["poNo", "productCode", "factoryGloveCode", "inspectionDate", "mfgDate", "expiryDate"] as const satisfies readonly DocumentHeaderField[];

/**
 * Filled even though set: the inspection date starts as the day the
 * inspection is created, but on paper the visit comes first, so the form's
 * date is the real one. Nothing has been typed into it yet at creation.
 */
const REPLACES_PREFILL: ReadonlySet<DocumentHeaderField> = new Set(["inspectionDate"]);

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * The new inspection's data with the document's header values and order
 * lines filled in: only fields the template shows, only sizes it offers,
 * only where nothing is set yet. `filled` names each, for the audit log.
 */
export function applyDocumentFill(
  data: InspectionData,
  fill: DocumentFill,
  template: ResolvedTemplate,
): { data: InspectionData; filled: string[] } {
  const filled: string[] = [];
  let next = data;

  const header = readModuleEntry(next, "modules", "header");
  const headerData = HeaderDataSchema.safeParse(header.hasData ? header.value : {});
  if (template.modules.some((entry) => entry.key === "header" && entry.include) && headerData.success) {
    const values = { ...headerData.data };
    for (const field of HEADER_FIELDS) {
      const value = fill.header[field];
      if (value === null || (!isEmpty(values[field]) && !REPLACES_PREFILL.has(field)) || !templateShowsField(template, "header", field)) continue;
      if (values[field] === value) continue;
      values[field] = value;
      filled.push(`header.${field}`);
    }
    next = writeModuleData(next, "modules", "header", values);
  }

  const order = readModuleEntry(next, "modules", "order_lots");
  const orderData = OrderLotsDataSchema.safeParse(order.hasData ? order.value : {});
  if (template.modules.some((entry) => entry.key === "order_lots" && entry.include) && orderData.success) {
    const offered = new Set(template.sizes.map((size) => size.value));
    const sizes = { ...orderData.data.sizes };
    for (const [size, line] of Object.entries(fill.sizes)) {
      if (!offered.has(size)) continue;
      const current = sizes[size] ?? emptyOrderLine();
      const qtyCases = current.qtyCases === null ? line.qtyCases : current.qtyCases;
      const lotNumbers = current.lotNumbers.length === 0 && line.lotNumbers.length > 0 ? line.lotNumbers : current.lotNumbers;
      if (qtyCases === current.qtyCases && lotNumbers === current.lotNumbers) continue;
      sizes[size] = { ...current, qtyCases, lotNumbers };
      filled.push(`order_lots.${size}`);
    }
    next = writeModuleData(next, "modules", "order_lots", { ...orderData.data, sizes });
  }

  return { data: next, filled };
}
