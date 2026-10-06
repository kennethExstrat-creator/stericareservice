// The inspection context: numbers that flow forward (BUILD_SPEC 8 "Speed",
// 6.2 rules 4, 7 and 10). Values entered once in one module and read by
// others: the ordered sizes from order_lots, the header values, packing,
// the sampling plan's n per size, the carton list per size, the indicative
// weight and the AQL defaults.
//
// It is built before any calc runs. Each source module contributes from its
// own saved data (`contribute`), so every calc sees the complete context
// whatever the template's module order. A source module that is switched
// off or not filled in leaves its part empty; readers must cope with that.
// A contribution that throws, or names a part another module owns, is left
// out and recorded, and the engine reports it on that module: one module's
// bug never stops the others.
import type { EntityRef, ProductType, Standard } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedSize, ResolvedTemplate, TemplateUnit } from "@/lib/schemas/template";
import { normaliseSize, orderSizes } from "@/lib/sizes";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import type { ModuleRegistry } from "./contract";
import { readModuleEntry, type InspectionData } from "./data";

/** ISO 2859-1 inspection levels (BUILD_SPEC 7). */
export const INSPECTION_LEVELS = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];

export type AqlSettings = {
  watertight: number;
  critical: number;
  major: number;
  minor: number;
  /** Set by the template's sampling plan; null means n is taken as entered. */
  inspectionLevel: InspectionLevel | null;
};

/**
 * BUILD_SPEC 7 defaults. Per-client values replace them when the context is
 * built; a module's template config replaces both (template > client > app).
 */
export const AQL_DEFAULTS: Readonly<AqlSettings> = {
  watertight: 1.5,
  critical: 0,
  major: 2.5,
  minor: 4.0,
  inspectionLevel: null,
};

/** Entered once in `header` and used everywhere, the export included (6.2 rule 10). */
export type HeaderValues = {
  client: string | null;
  manufacturer: string | null;
  poNo: string | null;
  productName: string | null;
  productCode: string | null;
  /** `YYYY-MM-DD`. */
  inspectionDate: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
};

export type OrderLine = {
  qtyCases: number | null;
  lotNumbers: readonly string[];
};

export type PackingValues = {
  /** "inner box", "plastic pack", "dispenser box", "pouch". */
  innerUnit: string | null;
  glovesPerInner: number | null;
  innersPerCase: number | null;
  glovesPerCase: number | null;
};

/** The sampling plan for one size: n for the modules that follow (BUILD_SPEC 6.1 sampling_plan). */
export type SamplingValues = {
  cases: number | null;
  innerUnits: number | null;
  gloves: number | null;
  watertightVisual: number | null;
  dimensions: number | null;
  /** Force at break or tensile. */
  physical: number | null;
  packagingDispensing: number | null;
  /** Surgical gloves: sampled pouches (the SG form's 'Pouches' under Sampling Quantity). */
  pouches: number | null;
  /** Surgical gloves: pouches for the dye leak test (a separate column on the SG form). */
  pouchesDyeLeak: number | null;
};

export type IndicativeWeight = { grams: number; size: string };

/** From the inspection row, not typed in a module. */
export type InspectionMeta = {
  refNo?: string | null;
  inspectionDate?: string | null;
  inspector?: EntityRef | null;
  client?: EntityRef | null;
  manufacturer?: EntityRef | null;
};

/** A source module whose contribution was left out, wholly or in part, and why. */
export type ContributionError = { moduleKey: ModuleKey; message: string };

export type InspectionContext = {
  template: {
    code: string;
    name: string;
    productType: ProductType;
    standard: Standard;
    unit: TemplateUnit;
  };
  /** Sizes the template offers, canonical, in template order. */
  templateSizes: readonly ResolvedSize[];
  /** Sizes in order_lots, canonical, in template order: the only sizes any module shows (6.2 rule 4). */
  sizes: readonly string[];
  order: Readonly<Record<string, OrderLine>>;
  header: HeaderValues;
  inspection: {
    refNo: string | null;
    /** Always recorded (6.2 rule 11). */
    inspector: EntityRef | null;
    client: EntityRef | null;
    manufacturer: EntityRef | null;
  };
  packing: PackingValues;
  sampling: Readonly<Record<string, SamplingValues>>;
  /** Sampled carton numbers per size, unique, in entry order: what box pickers offer (6.2 rule 7). */
  cartons: Readonly<Record<string, readonly number[]>>;
  indicativeWeight: IndicativeWeight | null;
  aql: AqlSettings;
  /** For the engine, which reports each as a `contribute_failed` error on that module. */
  contributionErrors: readonly ContributionError[];
};

/** What a source module adds. Per-size maps may use any size spelling; the builder normalises. */
export type ContextContribution = {
  header?: Partial<HeaderValues>;
  sizes?: readonly string[];
  order?: Readonly<Record<string, Partial<OrderLine>>>;
  packing?: Partial<PackingValues>;
  sampling?: Readonly<Record<string, Partial<SamplingValues>>>;
  cartons?: Readonly<Record<string, readonly number[]>>;
  indicativeWeight?: IndicativeWeight | null;
  aql?: Partial<AqlSettings>;
};

/** The one module that may contribute each part of the context. */
export const CONTEXT_SOURCES = {
  header: "header",
  indicativeWeight: "glove_info",
  sizes: "order_lots",
  order: "order_lots",
  packing: "packing_config",
  sampling: "sampling_plan",
  cartons: "carton_sampling",
  aql: "sampling_plan",
} as const satisfies { readonly [K in keyof Required<ContextContribution>]: ModuleKey };

export const EMPTY_SAMPLING: Readonly<SamplingValues> = {
  cases: null,
  innerUnits: null,
  gloves: null,
  watertightVisual: null,
  dimensions: null,
  physical: null,
  packagingDispensing: null,
  pouches: null,
  pouchesDyeLeak: null,
};

const EMPTY_PACKING: Readonly<PackingValues> = {
  innerUnit: null,
  glovesPerInner: null,
  innersPerCase: null,
  glovesPerCase: null,
};

export type BuildContextInput = {
  /** With per-inspection overrides applied: modules switched off contribute nothing. */
  template: ResolvedTemplate;
  data: InspectionData;
  meta?: InspectionMeta;
  /** Per-client AQL defaults (BUILD_SPEC 7). */
  aqlDefaults?: Partial<AqlSettings>;
};

/** Before any module contributes: template facts, the inspection row and the defaults. */
export function baseContext({ template, meta = {}, aqlDefaults = {} }: Omit<BuildContextInput, "data">): InspectionContext {
  return {
    template: {
      code: template.code,
      name: template.name,
      productType: template.scope.productType,
      standard: template.scope.standard,
      unit: template.unit,
    },
    templateSizes: template.sizes,
    sizes: [],
    order: {},
    header: {
      client: meta.client?.name ?? null,
      manufacturer: meta.manufacturer?.name ?? null,
      poNo: null,
      productName: null,
      productCode: null,
      inspectionDate: meta.inspectionDate ?? null,
      mfgDate: null,
      expiryDate: null,
    },
    inspection: {
      refNo: meta.refNo ?? null,
      inspector: meta.inspector ?? null,
      client: meta.client ?? null,
      manufacturer: meta.manufacturer ?? null,
    },
    packing: { ...EMPTY_PACKING },
    sampling: {},
    cartons: {},
    indicativeWeight: null,
    aql: { ...AQL_DEFAULTS, ...withoutUndefined(aqlDefaults) },
    contributionErrors: [],
  };
}

/**
 * Runs every included module's `contribute` on its saved data. Data or config
 * that fails its schema contributes nothing (the engine reports it). A
 * contribution that throws is left out, and so is a part the module does not
 * own; both are recorded in `contributionErrors`.
 */
export function buildInspectionContext(input: BuildContextInput, registry: ModuleRegistry): InspectionContext {
  let context = baseContext(input);
  const errors: ContributionError[] = [];
  for (const resolved of input.template.modules) {
    if (!resolved.include) continue;
    const definition = registry[resolved.key];
    if (!definition.contribute) continue;
    const entry = readModuleEntry(input.data, "modules", resolved.key);
    if (!entry.hasData) continue;
    try {
      const data = definition.dataSchema.safeParse(entry.value);
      const config = definition.configSchema.safeParse(resolved.config);
      if (!data.success || !config.success) continue;
      const { owned, refused } = splitContribution(
        resolved.key,
        definition.contribute({ data: data.data, config: config.data }),
      );
      context = applyContribution(context, owned);
      if (refused.length > 0) errors.push({ moduleKey: resolved.key, message: refused.join(" ") });
    } catch (error) {
      errors.push({ moduleKey: resolved.key, message: `contribute failed: ${messageOf(error)}` });
    }
  }
  return restrictToOrderedSizes({ ...context, contributionErrors: errors });
}

/**
 * The parts of a contribution that `key` owns (CONTEXT_SOURCES), and one line
 * for each part it may not provide, which is left out.
 */
export function splitContribution(
  key: ModuleKey,
  contribution: ContextContribution,
): { owned: ContextContribution; refused: string[] } {
  const owners: Partial<Record<string, ModuleKey>> = CONTEXT_SOURCES;
  const owned: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [part, value] of Object.entries(contribution)) {
    if (value === undefined) continue;
    const owner = owners[part];
    if (owner === key) owned[part] = value;
    else if (owner === undefined) refused.push(`${key} contributed "${part}", which is not part of the context.`);
    else refused.push(`${key} contributed "${part}", which only ${owner} may provide.`);
  }
  return { owned: owned as ContextContribution, refused };
}

export function applyContribution(context: InspectionContext, contribution: ContextContribution): InspectionContext {
  const next = { ...context };
  if (contribution.header) {
    next.header = { ...context.header, ...withoutBlanks(contribution.header) };
  }
  if (contribution.sizes) {
    next.sizes = orderSizes(
      contribution.sizes,
      context.templateSizes.map((size) => size.value),
    );
  }
  if (contribution.order) {
    next.order = mapSizes(contribution.order, (line) => ({
      qtyCases: finiteOrNull(line.qtyCases),
      lotNumbers: (line.lotNumbers ?? []).filter((lot) => lot.trim() !== ""),
    }));
  }
  if (contribution.packing) {
    next.packing = { ...EMPTY_PACKING, ...withoutUndefined(contribution.packing) };
  }
  if (contribution.sampling) {
    next.sampling = mapSizes(contribution.sampling, (line) => ({ ...EMPTY_SAMPLING, ...withoutUndefined(line) }));
  }
  if (contribution.cartons) {
    next.cartons = mapSizes(contribution.cartons, (cartons) => [
      ...new Set(cartons.filter((carton) => Number.isInteger(carton) && carton > 0)),
    ]);
  }
  if (contribution.indicativeWeight !== undefined) {
    const weight = contribution.indicativeWeight;
    const size = weight ? normaliseSize(weight.size) : null;
    next.indicativeWeight = weight && size && Number.isFinite(weight.grams) ? { grams: weight.grams, size } : null;
  }
  if (contribution.aql) {
    next.aql = { ...context.aql, ...withoutUndefined(contribution.aql) };
  }
  return next;
}

/** Per-size parts keep only ordered sizes (6.2 rule 4). */
export function restrictToOrderedSizes(context: InspectionContext): InspectionContext {
  const keep = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(context.sizes.filter((size) => size in record).map((size) => [size, record[size]]));
  return { ...context, order: keep(context.order), sampling: keep(context.sampling), cartons: keep(context.cartons) };
}

/* Readers for calcs and capture screens ------------------------------- */

export function samplingFor(context: InspectionContext, size: string): SamplingValues {
  return context.sampling[size] ?? EMPTY_SAMPLING;
}

export function cartonsFor(context: InspectionContext, size: string): readonly number[] {
  return context.cartons[size] ?? [];
}

/** Gloves in the lot of one size: cases ordered x gloves per case; null until both are known. */
export function lotSizeGloves(context: InspectionContext, size: string): number | null {
  const cases = context.order[size]?.qtyCases ?? null;
  const perCase = context.packing.glovesPerCase;
  return cases === null || perCase === null ? null : cases * perCase;
}

/** The template's label for a size ("Medium"), or the size itself. */
export function sizeLabel(context: InspectionContext, size: string): string {
  return context.templateSizes.find((entry) => entry.value === size)?.label ?? size;
}

/**
 * The `inspections` columns that repeat module values for search and lists,
 * copied on save so they always match the header and order (6.2 rule 10).
 */
export function inspectionRowValues(
  context: InspectionContext,
): Required<Pick<TablesUpdate<"inspections">, "po_no" | "product_name" | "lot_numbers">> {
  const lots = context.sizes.flatMap((size) => context.order[size]?.lotNumbers ?? []);
  return { po_no: context.header.poNo, product_name: context.header.productName, lot_numbers: [...new Set(lots)] };
}

/* Helpers ------------------------------------------------------------- */

function mapSizes<T, U>(record: Readonly<Record<string, T>>, map: (value: T) => U): Record<string, U> {
  const result: Record<string, U> = {};
  for (const [size, value] of Object.entries(record)) {
    const canonical = normaliseSize(size);
    // An exact canonical key wins over a variant spelling of the same size.
    if (canonical !== null && (!(canonical in result) || size === canonical)) result[canonical] = map(value);
  }
  return result;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** A blank header field keeps the value from the inspection row. */
function withoutBlanks<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null && !(typeof entry === "string" && entry.trim() === ""),
    ),
  ) as Partial<T>;
}
