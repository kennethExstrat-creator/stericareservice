// The inspection context: numbers that flow forward (BUILD_SPEC 8 "Speed",
// 6.2 rules 4, 7 and 10). Values entered once in one module and read by
// others: the ordered sizes from order_lots, the header values, packing,
// the sampling plan's n per size, the carton list per size, the indicative
// weight and the AQL defaults.
//
// It is built before any calc runs. Each source module contributes from its
// own saved data (`contribute`), so every calc sees the complete context
// whatever the template's module order. A source module that is switched
// off or not filled in leaves its part empty, apart from what its config
// gives; readers must cope with that. Saved data that partly fails its
// schema still gives what can be read. A contribution that throws, or names
// a part another module owns, is left out and recorded, and the engine
// reports it on that module: one module's bug never stops the others.
//
// It also carries what modules need about the inspection itself: the
// included modules with their titles, and its files when the caller knows
// them (the file channel, files.ts).
import type { z } from "zod";
import type { EntityRef, ProductType, Standard } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedSize, ResolvedTemplate, TemplateUnit } from "@/lib/schemas/template";
import { normaliseSize, orderSizes } from "@/lib/sizes";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { shortTitleFor } from "@/lib/templates/short-titles";
import type { CaptureFocus, ModuleRegistry } from "./contract";
import { readModuleEntry, type InspectionData, type ModuleEntry } from "./data";
import type { InspectionFileRef } from "./files";
import { salvageData, type SalvagedData } from "./salvage";

/** ISO 2859-1 inspection levels (BUILD_SPEC 7). */
export const INSPECTION_LEVELS = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];

/** The checks on the watertight and visual sample that apply an AQL: watertight, and visual's three classes. */
export const AQL_CHECKS = ["watertight", "critical", "major", "minor"] as const;
export type AqlCheck = (typeof AQL_CHECKS)[number];

export type AqlSettings = {
  /**
   * The AQL each check applies on this inspection. Null when the inspection
   * does not run the check (watertight switched off; visual, or one of its
   * classes, switched off), so no sampling plan needs its AQL.
   */
  [K in AqlCheck]: number | null;
} & {
  /** Set by the template's sampling plan; null means n is taken as entered. */
  inspectionLevel: InspectionLevel | null;
};

/** BUILD_SPEC 7's AQLs, or a client's: every check has one. */
export type AqlDefaults = { [K in AqlCheck]: number } & { inspectionLevel: InspectionLevel | null };

/**
 * BUILD_SPEC 7 defaults. Per-client values replace them when the context is
 * built; a module's template config replaces both (template > client > app).
 */
export const AQL_DEFAULTS: Readonly<AqlDefaults> = {
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

/**
 * The sampling plan for one size: n for the modules that follow (BUILD_SPEC
 * 6.1 sampling_plan). Each test reads its own count, never another's
 * (Kenneth, 12 October 2026: "each metrics and measurement should have their
 * own number of glove count"); watertight and visual share one because the
 * forms print one ("# Gloves for Watertight & Visual").
 */
export type SamplingValues = {
  cases: number | null;
  innerUnits: number | null;
  gloves: number | null;
  watertightVisual: number | null;
  dimensions: number | null;
  /** Force at break or tensile. */
  physical: number | null;
  /** Gloves weighed ("# Gloves for Weight"); null on a template without the row, so weight weighs its own n. */
  weight: number | null;
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
  /**
   * The inspection's lab reports and certificates as far as the caller knows
   * them: inspection_files rows on the server; on the capture screen, those
   * uploaded plus those still queued on this device. Pass them on every path
   * that decides a result (capture, submit, review, export), so they all
   * agree: without them a kept file id counts as attached even after its file
   * is deleted, and a lab report added in the gallery counts for nothing.
   * Leave it out (or null) only while they are not loaded; never pass an
   * empty list for "not loaded yet". Optional in the type only so that
   * callers written before it compile.
   */
  files?: readonly InspectionFileRef[] | null;
};

/** A module the inspection includes, with its heading in the template's wording. */
export type IncludedModule = { key: ModuleKey; title: string };

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
  /**
   * Sampled box/carton numbers per size, unique, in entry order: the
   * suggestions of the box/carton fields in dispensing and labelling, and
   * what boxNotSampledIssue checks them against (6.2 rule 7).
   */
  cartons: Readonly<Record<string, readonly number[]>>;
  indicativeWeight: IndicativeWeight | null;
  /**
   * Indicative weight in g by size, from the glove variants (glove_info): a
   * variant of one size gives that size's; one of several sizes or every
   * size gives the reference size's (M). Weight compares each size with its own.
   */
  indicativeWeights: Readonly<Record<string, number>>;
  aql: AqlSettings;
  /**
   * The modules the inspection includes, in template order, with their
   * titles in the template's wording (6.2 rule 11), any count in one as the
   * inspection has it once withShownTitles has run (buildInspectionView):
   * how a module names another, e.g. the conclusion's "not done: Glove
   * Packing Check". Read it with `moduleTitle`; optional only for contexts
   * built before it existed.
   */
  modules?: readonly IncludedModule[];
  /**
   * The inspection's files (InspectionMeta.files), or null when the caller
   * does not know them. Read with `heldFileState`; optional only for
   * contexts built before it existed.
   */
  files?: readonly InspectionFileRef[] | null;
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
  indicativeWeights?: Readonly<Record<string, number>>;
  aql?: Partial<AqlSettings>;
};

/**
 * The one module that may contribute each part of the context. The AQL
 * settings are owned one by one (AQL_SOURCES); `aql` here names the sampling
 * plan, which sets the inspection level.
 */
export const CONTEXT_SOURCES = {
  header: "header",
  indicativeWeight: "glove_info",
  indicativeWeights: "glove_info",
  sizes: "order_lots",
  order: "order_lots",
  packing: "packing_config",
  sampling: "sampling_plan",
  cartons: "carton_sampling",
  aql: "sampling_plan",
} as const satisfies { readonly [K in keyof Required<ContextContribution>]: ModuleKey };

/**
 * The one module that may set each AQL setting, from the template's config:
 * the check that applies it, so the sampling plan's lot check sees the AQL
 * the template sets for watertight and visual (template over client over
 * BUILD_SPEC 7), and the sampling plan its inspection level. A module that
 * leaves a setting out keeps the client's or the default value; null says
 * the inspection does not run that check (a visual class switched off). A
 * check whose module the inspection does not include is null from the start.
 */
export const AQL_SOURCES = {
  watertight: "watertight",
  critical: "visual",
  major: "visual",
  minor: "visual",
  inspectionLevel: "sampling_plan",
} as const satisfies { readonly [K in keyof AqlSettings]: ModuleKey };

export const EMPTY_SAMPLING: Readonly<SamplingValues> = {
  cases: null,
  innerUnits: null,
  gloves: null,
  watertightVisual: null,
  dimensions: null,
  physical: null,
  weight: null,
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
  aqlDefaults?: Partial<AqlDefaults>;
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
    indicativeWeights: {},
    aql: checksRun(template, { ...AQL_DEFAULTS, ...withoutUndefined(aqlDefaults) }),
    modules: template.modules.filter((entry) => entry.include).map(({ key, title }) => ({ key, title })),
    files: meta.files ? meta.files.map((file) => ({ ...file })) : null,
    contributionErrors: [],
  };
}

/**
 * Runs every included module's `contribute` on its saved data, or on its
 * empty data when nothing is saved, so what comes from the template's config
 * (the inspection level, the inner unit's name) is there from the start.
 * Saved data that fails its schema contributes what can still be read
 * (`readableData`): one bad lot number never takes the ordered sizes away
 * from every per-size module; the engine reports the bad value as a blocking
 * error with its path. Config that fails its schema contributes nothing
 * (the engine reports it). A contribution that throws is left out, and so is
 * a part the module does not own; both are recorded in `contributionErrors`.
 */
export function buildInspectionContext(input: BuildContextInput, registry: ModuleRegistry): InspectionContext {
  let context = baseContext(input);
  const errors: ContributionError[] = [];
  for (const resolved of input.template.modules) {
    if (!resolved.include) continue;
    const definition = registry[resolved.key];
    if (!definition.contribute) continue;
    const entry = readModuleEntry(input.data, "modules", resolved.key);
    try {
      const config = definition.configSchema.safeParse(resolved.config);
      if (!config.success) continue;
      const data = readableData(definition, entry);
      if (data === null) continue;
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
 * A module's data as far as it can be read: its saved data parsed by its
 * schema, its empty data when nothing is saved, or, when the saved data
 * fails the schema, what is left once the values the schema rejects are
 * taken out (salvageData), with where they were. Null when nothing can be
 * read. For the context and for showing what is saved, read-only: an
 * editable Capture given it would save it back at the first edit, and the
 * rejected values would be gone without anyone deciding so. A screen may
 * offer one explicit "Remove the values that cannot be read" that saves it.
 */
export function readableData<TData>(
  definition: { readonly dataSchema: z.ZodType<TData>; emptyData(): TData },
  entry: ModuleEntry,
): SalvagedData<TData> | null {
  if (!entry.hasData) {
    const empty = definition.dataSchema.safeParse(definition.emptyData());
    return empty.success ? { data: empty.data, dropped: [] } : null;
  }
  return salvageData(definition.dataSchema, entry.value);
}

/**
 * The parts of a contribution that `key` owns (CONTEXT_SOURCES; the AQL
 * settings one by one, AQL_SOURCES), and one line for each part it may not
 * provide, which is left out.
 */
export function splitContribution(
  key: ModuleKey,
  contribution: ContextContribution,
): { owned: ContextContribution; refused: string[] } {
  const owners: Partial<Record<string, ModuleKey>> = CONTEXT_SOURCES;
  const aqlOwners: Partial<Record<string, ModuleKey>> = AQL_SOURCES;
  const owned: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [part, value] of Object.entries(contribution)) {
    if (value === undefined) continue;
    if (part === "aql" && typeof value === "object" && value !== null) {
      const aql: Record<string, unknown> = {};
      for (const [setting, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        const owner = aqlOwners[setting];
        if (owner === key) aql[setting] = entry;
        else if (owner === undefined) refused.push(`${key} contributed "aql.${setting}", which is not part of the context.`);
        else refused.push(`${key} contributed "aql.${setting}", which only ${owner} may provide.`);
      }
      if (Object.keys(aql).length > 0) owned.aql = aql;
      continue;
    }
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
  if (contribution.indicativeWeights !== undefined) {
    const weights: Record<string, number> = {};
    for (const [size, grams] of Object.entries(contribution.indicativeWeights)) {
      const key = normaliseSize(size);
      // The first variant to name a size gives its weight.
      if (key && Number.isFinite(grams) && grams > 0 && !(key in weights)) weights[key] = grams;
    }
    next.indicativeWeights = weights;
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
 * The size a per-size Capture opens on: the size the screen has in focus
 * (CaptureProps.focus) when it is ordered, else the first ordered size, else
 * "" while nothing is ordered.
 */
export function initialSize(context: Pick<InspectionContext, "sizes">, focus?: CaptureFocus | null): string {
  const size = focus?.size;
  if (size !== undefined && context.sizes.includes(size)) return size;
  return context.sizes[0] ?? "";
}

/** The modules the inspection includes, in template order, with their titles. */
export function includedModules(context: Pick<InspectionContext, "modules">): readonly IncludedModule[] {
  return context.modules ?? [];
}

/**
 * A module's heading in the template's wording ("Glove Packing Check"); for
 * a module the context does not list, its key in words ("Dispensing packing").
 */
export function moduleTitle(context: Pick<InspectionContext, "modules">, key: ModuleKey): string {
  const found = includedModules(context).find((entry) => entry.key === key);
  if (found && found.title.trim() !== "") return found.title;
  const words = key.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * A module's short name, as the capture screen's menus and messages name a
 * step ("Weight"; lib/templates/short-titles.ts), whatever its title says.
 * Calcs, validation messages, the review and the export keep `moduleTitle`.
 */
export function moduleShortTitle(context: Pick<InspectionContext, "modules">, key: ModuleKey): string {
  return shortTitleFor(key, moduleTitle(context, key));
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

/** The AQL settings with null for each check whose module the inspection does not include (AQL_SOURCES). */
function checksRun(template: Pick<ResolvedTemplate, "modules">, aql: AqlSettings): AqlSettings {
  const included = new Set(template.modules.filter((entry) => entry.include).map((entry) => entry.key));
  const run = { ...aql };
  for (const check of AQL_CHECKS) if (!included.has(AQL_SOURCES[check])) run[check] = null;
  return run;
}

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
