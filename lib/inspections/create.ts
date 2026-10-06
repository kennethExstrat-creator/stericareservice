// Starting an inspection (BUILD_SPEC 4.4, 8 "Start from previous" and 10
// /inspections/new): the form's input, the template choice, what "start from
// previous" copies and the new inspection's data. Pure: the module registry,
// the template and the rows are passed in, so the page, the Server Action and
// the tests share one rule book.
import { z } from "zod";
import { ProductTypeSchema, type InspectionStatus, type ProductType } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { selectTemplate, type Specificity, type TemplateCandidate } from "@/lib/templates/select";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { readModuleEntry, type InspectionData } from "@/modules/_framework/data";

/* ------------------------------------------------------------------ *
 * The form
 * ------------------------------------------------------------------ */

/** The client picker's value for an inspection without a client (the dictionary allows one). */
export const NO_CLIENT = "none";

export const PRODUCT_NAME_MAX = 300;

export const PRODUCT_TYPE_LABEL: Readonly<Record<ProductType, string>> = {
  examination: "Examination gloves",
  surgical: "Surgical gloves",
};

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(z.uuid().optional());

/** What /inspections/new posts. The client is a deliberate choice: a client's own template must not be missed. */
export const NewInspectionInputSchema = z.object({
  clientId: z
    .string()
    .trim()
    .refine((value) => value === NO_CLIENT || z.uuid().safeParse(value).success, {
      error: "Choose the client, or No client.",
    })
    .transform((value) => (value === NO_CLIENT ? null : value)),
  manufacturerId: z.string().trim().pipe(z.uuid({ error: "Choose the manufacturer." })),
  productType: z.enum(ProductTypeSchema.options, { error: "Choose the product type." }),
  productName: z
    .string()
    .trim()
    .max(PRODUCT_NAME_MAX, { error: `Keep the product name to ${PRODUCT_NAME_MAX} characters.` })
    .transform((value) => (value === "" ? null : value)),
  /** An admin's template override (BUILD_SPEC 4.4). */
  templateId: optionalId,
  /** The earlier inspection to start from. */
  previousId: optionalId,
});

export type NewInspectionInput = z.output<typeof NewInspectionInputSchema>;
export type NewInspectionField = keyof NewInspectionInput;

export const NEW_INSPECTION_FIELDS = [
  "clientId",
  "manufacturerId",
  "productType",
  "productName",
  "templateId",
  "previousId",
] as const satisfies readonly NewInspectionField[];

/** The form's fields as text: a missing field is empty, a file is ignored. */
export function readNewInspectionForm(formData: FormData): Record<NewInspectionField, string> {
  return Object.fromEntries(
    NEW_INSPECTION_FIELDS.map((field) => {
      const value = formData.get(field);
      return [field, typeof value === "string" ? value : ""];
    }),
  ) as Record<NewInspectionField, string>;
}

/** The first message for each field, for the form. */
export function fieldErrorsOf(error: z.ZodError): Partial<Record<NewInspectionField, string>> {
  const errors: Partial<Record<NewInspectionField, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in NewInspectionInputSchema.shape && !errors[field as NewInspectionField]) {
      errors[field as NewInspectionField] = issue.message;
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * The template (BUILD_SPEC 4.4)
 * ------------------------------------------------------------------ */

export type TemplateChoice =
  | {
      ok: true;
      template: TemplateCandidate;
      specificity: Specificity | "override";
      /** Other active templates just as specific: the tie was broken by code. */
      ties: TemplateCandidate[];
    }
  | { ok: false; message: string; field?: "templateId" };

/**
 * The most specific active template for client, manufacturer and product
 * type; or, for an admin only, the template they chose, which must be for the
 * same product type and not retired.
 */
export function chooseTemplate(
  candidates: readonly TemplateCandidate[],
  input: Pick<NewInspectionInput, "productType" | "clientId" | "manufacturerId" | "templateId">,
  role: "inspector" | "admin",
): TemplateChoice {
  if (input.templateId && role !== "admin") {
    return { ok: false, message: "Only an admin can choose the template.", field: "templateId" };
  }
  const selection = selectTemplate(candidates, {
    productType: input.productType,
    clientId: input.clientId,
    manufacturerId: input.manufacturerId,
    overrideTemplateId: input.templateId ?? null,
  });
  if (!selection.ok) {
    return input.templateId
      ? { ok: false, message: selection.message, field: "templateId" }
      : {
          ok: false,
          message: `No active template for ${PRODUCT_TYPE_LABEL[input.productType].toLowerCase()} fits these choices. An admin needs to activate one.`,
        };
  }
  if (selection.template.productType !== input.productType) {
    return {
      ok: false,
      field: "templateId",
      message: `${selection.template.code} is for ${PRODUCT_TYPE_LABEL[selection.template.productType].toLowerCase()}. Choose one for ${PRODUCT_TYPE_LABEL[input.productType].toLowerCase()}.`,
    };
  }
  return { ok: true, template: selection.template, specificity: selection.specificity, ties: selection.ties };
}

/** Why this template: "For Polyco Healthline at Hartalega NGC", "Standard template for examination gloves". */
export function choiceReason(
  specificity: Specificity | "override",
  names: { client: string | null; manufacturer: string | null },
  productType: ProductType,
): string {
  switch (specificity) {
    case "client_manufacturer":
      return `For ${names.client ?? "this client"} at ${names.manufacturer ?? "this manufacturer"}`;
    case "client":
      return `For ${names.client ?? "this client"}`;
    case "manufacturer":
      return `For ${names.manufacturer ?? "this manufacturer"}`;
    case "standard":
      return `Standard template for ${PRODUCT_TYPE_LABEL[productType].toLowerCase()}`;
    case "override":
      return "Chosen by an admin";
  }
}

/* ------------------------------------------------------------------ *
 * Start from previous (BUILD_SPEC 8)
 * ------------------------------------------------------------------ */

/**
 * What "Start from previous" copies, by module: the product's facts, which
 * stay the same from one shipment of a product to the next. Specs and AQL
 * live in the template, so they carry over with it.
 *
 * Never copied: the PO number, the inspection, manufacturing and expiry
 * dates, the order, lots and every other module (sampling, cartons, tests,
 * results, the conclusion), inspector comments and photos. The client and
 * manufacturer are this inspection's picks.
 */
export const PREVIOUS_COPY = {
  header: ["factoryAddress", "productName", "productCode", "factoryGloveCode"],
  glove_info: "all",
  packing_config: "all",
} as const satisfies Partial<Record<ModuleKey, "all" | readonly string[]>>;

export type CopiedModuleKey = keyof typeof PREVIOUS_COPY;

export const COPIED_MODULE_KEYS = Object.keys(PREVIOUS_COPY) as CopiedModuleKey[];

/** In plain words, for the screen. */
export const PREVIOUS_COPY_SUMMARY = {
  /** The modules' usual titles, for when no template is chosen yet. */
  titles: {
    header: "Manufacturer Information",
    glove_info: "Glove Information",
    packing_config: "Packing configuration",
  } satisfies Record<CopiedModuleKey, string>,
  copied: {
    header: "product name and code, factory address and factory glove code",
    glove_info: "every field",
    packing_config: "every field",
  } satisfies Record<CopiedModuleKey, string>,
  notCopied: "PO number, dates, lots, sampling, test results, comments and photos",
};

/** An earlier inspection the user can see, as the page lists them (newest first). */
export type PreviousInspectionRow = {
  id: string;
  ref_no: string;
  inspection_date: string;
  status: InspectionStatus;
  created_at: string;
  client_id: string | null;
  manufacturer_id: string | null;
  product_name: string | null;
  template: { code: string; version: number; product_type: ProductType } | null;
};

/** The latest inspection of one product for one client, manufacturer and product type. */
export type PreviousProduct = {
  inspectionId: string;
  refNo: string;
  inspectionDate: string;
  status: InspectionStatus;
  clientId: string | null;
  manufacturerId: string;
  productType: ProductType;
  productName: string | null;
  templateCode: string;
  templateVersion: number;
};

/** Product names match whatever their case and spacing: "Nitrile  blue" is "nitrile blue". */
export function productKey(name: string | null): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** One entry per client, manufacturer, product type and product: its latest inspection. */
export function latestPerProduct(rows: readonly PreviousInspectionRow[]): PreviousProduct[] {
  const newestFirst = [...rows].sort(
    (a, b) => b.inspection_date.localeCompare(a.inspection_date) || b.created_at.localeCompare(a.created_at),
  );
  const seen = new Set<string>();
  const products: PreviousProduct[] = [];
  for (const row of newestFirst) {
    if (row.manufacturer_id === null || row.template === null) continue;
    const key = [row.client_id ?? "", row.manufacturer_id, row.template.product_type, productKey(row.product_name)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      inspectionId: row.id,
      refNo: row.ref_no,
      inspectionDate: row.inspection_date,
      status: row.status,
      clientId: row.client_id,
      manufacturerId: row.manufacturer_id,
      productType: row.template.product_type,
      productName: row.product_name?.trim() ? row.product_name.trim() : null,
      templateCode: row.template.code,
      templateVersion: row.template.version,
    });
  }
  return products;
}

/** The products to start from for these picks, newest first. */
export function previousFor(
  products: readonly PreviousProduct[],
  picks: { clientId: string | null; manufacturerId: string | null; productType: ProductType | null },
): PreviousProduct[] {
  if (picks.manufacturerId === null || picks.productType === null) return [];
  return products.filter(
    (product) =>
      product.clientId === picks.clientId &&
      product.manufacturerId === picks.manufacturerId &&
      product.productType === picks.productType,
  );
}

/** Whether an earlier inspection may be started from for these picks: same client, manufacturer and product type. */
export function previousMatches(
  previous: { clientId: string | null; manufacturerId: string | null; productType: ProductType | null },
  input: Pick<NewInspectionInput, "clientId" | "manufacturerId" | "productType">,
): boolean {
  return (
    previous.clientId === input.clientId &&
    previous.manufacturerId === input.manufacturerId &&
    previous.productType === input.productType
  );
}

/* ------------------------------------------------------------------ *
 * The new inspection's data
 * ------------------------------------------------------------------ */

/** Inspection dates are calendar days in Malaysia, as the database's default (docs/DATABASE.md). */
export const INSPECTION_TIME_ZONE = "Asia/Kuala_Lumpur";

/** Today in Malaysia, `YYYY-MM-DD`. */
export function todayInMalaysia(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INSPECTION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.values(value).some(hasValue);
  return true;
}

/**
 * `values` laid over a module's data, one key at a time: a key the module's
 * schema refuses (it calls the value something else) is left out instead of
 * spoiling the rest.
 */
function withValues(
  definition: ModuleRegistry[ModuleKey],
  data: unknown,
  values: Readonly<Record<string, unknown>>,
): unknown {
  let current = data;
  for (const [key, value] of Object.entries(values)) {
    if (!isRecord(current)) break;
    const parsed = definition.dataSchema.safeParse({ ...current, [key]: value });
    if (parsed.success) current = parsed.data;
  }
  return current;
}

/**
 * Whether a template shows one of a module's fields: the module is on and
 * its config does not switch the field off. Modules switch fields by key
 * under `fields` (docs/MODULES.md section 6, lib/coverage: header,
 * glove_info, order_lots, packing_config, loading); a field without a switch
 * shows.
 */
export function templateShowsField(template: ResolvedTemplate, key: ModuleKey, field: string): boolean {
  const entry = template.modules.find((candidate) => candidate.key === key && candidate.include);
  if (!entry) return false;
  const fields = isRecord(entry.config) ? entry.config.fields : undefined;
  return !isRecord(fields) || fields[field] !== false;
}

/**
 * The modules "start from previous" fills in from an earlier inspection's
 * data, for the modules and fields the new template switches on. Each value
 * goes through the module's schema onto its empty data, one at a time: a
 * value the module no longer takes (renamed since, or text where a number
 * belongs) is left out, and a module left with nothing is not counted as
 * copied.
 */
export function copyFromPrevious(
  previous: InspectionData,
  template: ResolvedTemplate,
  registry: ModuleRegistry,
): { modules: Partial<Record<CopiedModuleKey, unknown>>; copied: CopiedModuleKey[] } {
  const modules: Partial<Record<CopiedModuleKey, unknown>> = {};
  const copied: CopiedModuleKey[] = [];
  for (const key of COPIED_MODULE_KEYS) {
    if (!template.modules.some((entry) => entry.key === key && entry.include)) continue;
    // readModuleEntry leaves the inspector's comment behind.
    const { value, hasData } = readModuleEntry(previous, "modules", key);
    if (!hasData || !isRecord(value)) continue;
    const fields = PREVIOUS_COPY[key];
    const listed = fields === "all" ? Object.keys(value) : fields.filter((field) => field in value);
    // A field the new template switches off stays behind.
    const picked = Object.fromEntries(
      listed.filter((field) => templateShowsField(template, key, field)).map((field) => [field, value[field]]),
    );
    const definition = registry[key];
    const data = withValues(definition, definition.emptyData(), picked);
    if (!hasValue(data)) continue;
    modules[key] = data;
    copied.push(key);
  }
  return { modules, copied };
}

/** What the header starts with besides a copy (lib/coverage: the header's prefills). */
export type HeaderPrefill = {
  /** Today in Malaysia, as the row's inspection_date. */
  inspectionDate: string;
  /** As typed on the form; the row repeats it (BUILD_SPEC 6.2 rule 10). */
  productName: string | null;
  /** The picked manufacturer's address (manufacturers.address); a copied address wins. */
  factoryAddress?: string | null;
};

/**
 * The header values a new inspection starts with, for the rows its template
 * shows: the inspection date, the product name from the form (over a copied
 * one) and the manufacturer's address (unless one was copied).
 */
export function headerPrefill(
  template: ResolvedTemplate,
  prefill: HeaderPrefill,
  copiedHeader: unknown,
): Record<string, string> {
  const values: Record<string, string> = { inspectionDate: prefill.inspectionDate };
  if (prefill.productName !== null && prefill.productName.trim() !== "") values.productName = prefill.productName.trim();
  const address = prefill.factoryAddress?.trim() ?? "";
  const copiedAddress = isRecord(copiedHeader) && hasValue(copiedHeader.factoryAddress);
  if (address !== "" && !copiedAddress) values.factoryAddress = address;
  return Object.fromEntries(Object.entries(values).filter(([field]) => templateShowsField(template, "header", field)));
}

/**
 * The data a new inspection starts with: each included module's empty data,
 * with what "start from previous" copied, and the header's prefills
 * (headerPrefill): the inspection date and product name, which the row
 * repeats, and the manufacturer's address. Custom modules start empty.
 */
export function newInspectionData(
  input: HeaderPrefill & {
    template: ResolvedTemplate;
    registry: ModuleRegistry;
    previous?: InspectionData | null;
  },
): { data: InspectionData; copied: CopiedModuleKey[] } {
  const { template, registry } = input;
  const copy = input.previous ? copyFromPrevious(input.previous, template, registry) : { modules: {}, copied: [] };
  const modules: Record<string, unknown> = {};
  for (const entry of template.modules) {
    if (!entry.include) continue;
    const copiedData = (copy.modules as Record<string, unknown>)[entry.key];
    modules[entry.key] = copiedData === undefined ? registry[entry.key].emptyData() : copiedData;
  }
  if ("header" in modules) {
    const copiedHeader = (copy.modules as Record<string, unknown>).header;
    modules.header = withValues(registry.header, modules.header, headerPrefill(template, input, copiedHeader));
  }
  return { data: { modules, custom: {} }, copied: copy.copied };
}

/* ------------------------------------------------------------------ *
 * Saving
 * ------------------------------------------------------------------ */

/** A database refusal in words for the form (docs/DATABASE.md, "Notes for app code"). */
export function describeCreateError(error: { code?: string; message?: string }): string {
  if (error.code === "23514" && /active template/i.test(error.message ?? "")) {
    return "That template is no longer active. Reload the page to see the current one.";
  }
  if (error.code === "23503") return "The client, manufacturer or template has gone. Reload the page and pick again.";
  if (error.code === "42501") return "Your account is not allowed to start this inspection. Ask an admin to check it.";
  return "The inspection could not be created. Try again.";
}
