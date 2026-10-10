// Filling a new inspection from an order document (docs/AI.md, "Reading order
// documents"). Pure: what Claude read is checked here before anything is
// filled in, and the fill goes only into fields that are still empty, so a
// document never overwrites what the inspector or "start from previous" set.
import { IsoDateSchema } from "@/lib/schemas/common";
import type { DocumentFill, DocumentFormFields, DocumentHeaderField, DocumentReading } from "@/lib/schemas/document-fill";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { normaliseSize } from "@/lib/sizes";
import { readModuleEntry, writeModuleData, type InspectionData } from "@/modules/_framework/data";
import { HeaderDataSchema } from "@/modules/header/schema";
import { emptyOrderLine, OrderLotsDataSchema } from "@/modules/order_lots/schema";
import { PRODUCT_NAME_MAX, templateShowsField } from "./create";

type Listed = readonly { id: string; name: string }[];

/** Trimmed, spaces collapsed, at most `max` characters; null when empty. */
function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text === "" ? null : text;
}

function date(value: string | null): string | null {
  const text = clean(value, 10);
  return text && IsoDateSchema.safeParse(text).success ? text : null;
}

/**
 * What the form may use from Claude's answer: ids only from the lists the
 * user was offered, dates that are real dates, sizes the app knows (lines of
 * one size added up), lots trimmed and once each.
 */
export function checkReading(
  reading: DocumentReading,
  lists: { clients: Listed; manufacturers: Listed },
  fileName: string,
): { form: DocumentFormFields; fill: DocumentFill; notes: string | null } {
  const listed = (id: string | null, entries: Listed) => (id && entries.some((entry) => entry.id === id) ? id : null);

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
      clientId: listed(reading.clientId, lists.clients),
      clientName: clean(reading.clientName, 200),
      manufacturerId: listed(reading.manufacturerId, lists.manufacturers),
      manufacturerName: clean(reading.manufacturerName, 200),
      productType: reading.productType,
      productName: clean(reading.productName, PRODUCT_NAME_MAX),
    },
    fill: {
      fileName: fileName.slice(0, 255),
      header: {
        poNo: clean(reading.poNo, 2000),
        productCode: clean(reading.productCode, 2000),
        factoryGloveCode: clean(reading.factoryGloveCode, 2000),
        mfgDate: date(reading.mfgDate),
        expiryDate: date(reading.expiryDate),
      },
      sizes,
    },
    notes: clean(reading.notes, 600),
  };
}

const HEADER_FIELDS = ["poNo", "productCode", "factoryGloveCode", "mfgDate", "expiryDate"] as const satisfies readonly DocumentHeaderField[];

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
      if (value === null || !isEmpty(values[field]) || !templateShowsField(template, "header", field)) continue;
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
