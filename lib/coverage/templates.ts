// What each seed template fixes (BUILD_SPEC 11): modules on and their order,
// sizes, unit, report title, and every module's config in the keys of the
// dictionary (fields.ts), with the values the reports print. STD_SG has no
// filled report: what the SG onsite form does not fix is in `toConfirm`.
import type { FieldType, ProductType, Standard } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { Spec } from "@/lib/stats/spec";
import type { StatisticKind } from "@/lib/stats/statistics";
import {
  LABELLING_CHECK_LISTS,
  listItems,
  safedonDefectItems,
  stickinessCodes,
  VISUAL_DEFECTS,
  WATERTIGHT_LOCATIONS,
  type LabellingCheckLabel,
  type ListItem,
  type SafedonDefectConfig,
  type StickinessCode,
} from "./defects";
import { captionLabel, fieldLabel, moduleSpec, moduleTitle, type ConfigKey } from "./fields";
import {
  DEFECT_CLASSES,
  GLOVE_INFO_FIELDS,
  HEADER_FIELDS,
  MEASURES,
  type DefectClass,
  type DocumentItem,
  type GloveInfoField,
  type HeaderField,
  type InnerUnit,
  type InspectionLevel,
  type LabellingLevel,
  type LoadingField,
  type Measure,
  type SamplingColumn,
} from "./keys";
import type { SourceId, TemplateCode } from "./types";

/* ------------------------------------------------------------------ *
 * Config value types, one per module, keyed as in fields.ts
 * ------------------------------------------------------------------ */

type EmptyConfig = Record<never, never>;

export type SizeSpecs<K extends string> = Readonly<Record<string, Readonly<Partial<Record<K, Spec>>>>>;
export type RowCount = { readonly default: number; readonly bySize?: Readonly<Record<string, number>> };
export type ClassConfig = { readonly include: boolean; readonly aql: number; readonly defects: readonly ListItem[] };
export type LevelConfig = {
  readonly include: boolean;
  readonly n: number;
  readonly checks: readonly LabellingCheckLabel[];
};

export type ModuleConfigValues = {
  readonly header: {
    readonly fields: Readonly<Record<HeaderField, boolean>>;
    readonly mfgExpiryPrecision: "day" | "month";
  };
  readonly glove_info: {
    readonly fields: Readonly<Record<GloveInfoField, boolean>>;
    readonly indicativeWeightSize: string;
  };
  readonly order_lots: { readonly fields: { readonly packingSite: boolean } };
  readonly packing_config: { readonly innerUnit: InnerUnit; readonly fields: { readonly packingMode: boolean } };
  readonly sampling_plan: {
    readonly columns: Readonly<Record<SamplingColumn, boolean>>;
    readonly inspectionLevel: InspectionLevel | null;
  };
  readonly carton_sampling: EmptyConfig;
  readonly dimensions: {
    readonly measures: readonly Measure[];
    /** null: to confirm. */
    readonly statistic: StatisticKind | null;
    /** null: to confirm. */
    readonly specs: SizeSpecs<Measure> | null;
    readonly decimals: Readonly<Partial<Record<Measure, number>>>;
    readonly rows: number;
  };
  readonly weight: {
    readonly n: number;
    readonly specs: Readonly<Record<string, Spec>> | null;
    readonly warnThresholdPct: number;
    readonly decimals: number;
  };
  readonly force_at_break: {
    readonly n: number;
    readonly specMin: number;
    readonly standardLabel: string | null;
    readonly decimals: number;
  };
  readonly tensile: {
    readonly tensileMin: number;
    readonly elongationMin: number;
    readonly standardLabel: string;
    readonly decimals: { readonly tensileStrength: number; readonly elongationAtBreak: number };
  };
  readonly watertight: { readonly aql: number; readonly locations: readonly ListItem[]; readonly handSplit: boolean };
  readonly visual: { readonly handSplit: boolean; readonly classes: Readonly<Record<DefectClass, ClassConfig>> };
  readonly dispensing_packing: {
    readonly minLayeringPct: number;
    readonly minDispensingPct: number;
    readonly stickinessCodes: readonly StickinessCode[];
    readonly boxesPerSize: RowCount;
  };
  readonly dispensing_safedon: {
    readonly defects: readonly SafedonDefectConfig[];
    readonly glovesPerPack: number;
    readonly maxRatePct: number;
    readonly boxesPerSize: RowCount;
  };
  readonly labeling: { readonly levels: Readonly<Record<LabellingLevel, LevelConfig>> };
  readonly conclusion: EmptyConfig;
  readonly dye_leak: { readonly n: number | null };
  readonly documents: {
    readonly items: readonly { readonly key: DocumentItem; readonly include: boolean; readonly required: boolean }[];
  };
  readonly loading: { readonly fields: Readonly<Record<LoadingField, boolean>> };
};

type KeysMatch<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : false;

/**
 * Compile-time check: each module's config value type has exactly the
 * config keys fields.ts defines. A mismatch turns that entry's type into
 * `false` and fails the typecheck.
 */
export const CONFIG_KEYS_MATCH_DICTIONARY: {
  readonly [M in ModuleKey]: KeysMatch<keyof ModuleConfigValues[M], ConfigKey<M>>;
} = {
  header: true,
  glove_info: true,
  order_lots: true,
  packing_config: true,
  sampling_plan: true,
  carton_sampling: true,
  dimensions: true,
  weight: true,
  force_at_break: true,
  tensile: true,
  watertight: true,
  visual: true,
  dispensing_packing: true,
  dispensing_safedon: true,
  labeling: true,
  conclusion: true,
  dye_leak: true,
  documents: true,
  loading: true,
};

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export type TemplateModule = { readonly [K in ModuleKey]: { readonly key: K; readonly config: ModuleConfigValues[K] } }[ModuleKey];

export type CustomFieldSpec = {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly hint?: string;
};

/** BUILD_SPEC 4.3 CustomModule, for fields no module holds. */
export type CustomModuleSpec = {
  readonly key: string;
  readonly title: string;
  readonly after: ModuleKey;
  readonly layout: "fields" | "table" | "grid";
  readonly fields: readonly CustomFieldSpec[];
};

/** A value that is provisional: `path` is `<module>.<config key>` or a template property. */
export type ToConfirm = { readonly path: string; readonly note: string };

export type TemplateSpec = {
  readonly code: TemplateCode;
  readonly name: string;
  readonly extends: TemplateCode | null;
  readonly scope: {
    readonly productType: ProductType;
    /** null: to confirm. */
    readonly standard: Standard | null;
    /** The template belongs to one client (BUILD_SPEC 4.4). */
    readonly clientScoped: boolean;
  };
  readonly builtFrom: readonly SourceId[];
  readonly unit: "pcs" | "pairs";
  /** Normalised sizes (rule 4.2.5), in report order. */
  readonly sizes: readonly { readonly value: string; readonly label?: string }[];
  readonly report: {
    /** The report's title block, line by line. null: to confirm. */
    readonly titleLines: readonly string[] | null;
    readonly showClientLogo: boolean;
    /** Running header of pages 2 on; {po} is the PO number, {product} the product name. */
    readonly pageHeader: string | null;
  };
  /** Included modules, in capture order (BUILD_SPEC 11). */
  readonly modules: readonly TemplateModule[];
  readonly customModules: readonly CustomModuleSpec[];
  readonly toConfirm: readonly ToConfirm[];
};

/* ------------------------------------------------------------------ *
 * Shared values
 * ------------------------------------------------------------------ */

const min = (value: number): Spec => ({ kind: "min", min: value });
const max = (value: number): Spec => ({ kind: "max", max: value });
const tol = (nominal: number, tolerance: number): Spec => ({ kind: "tolerance", nominal, tolerance });
const NA: Spec = { kind: "na" };

const sizes = (...values: string[]) => values.map((value) => ({ value }));
const EG_SIZES = sizes("XS", "S", "M", "L", "XL");

const allOn = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, true])) as Record<K, boolean>;

/** The AQLs of BUILD_SPEC 7 and the reports' headings: critical 0.0, major 2.5, minor 4.0. */
export const VISUAL_AQL: Readonly<Record<DefectClass, number>> = { critical: 0, major: 2.5, minor: 4 };
export const WATERTIGHT_AQL = 1.5;

function visualClasses(template: TemplateCode): Readonly<Record<DefectClass, ClassConfig>> {
  const lists = VISUAL_DEFECTS[template];
  return Object.fromEntries(
    DEFECT_CLASSES.map((cls) => [cls, { include: true, aql: VISUAL_AQL[cls], defects: listItems(lists[cls]) }]),
  ) as Record<DefectClass, ClassConfig>;
}

const STD_EG_SAMPLING_COLUMNS: Readonly<Record<SamplingColumn, boolean>> = {
  cases: true,
  innerUnits: true,
  gloves: true,
  glovesWatertightVisual: true,
  glovesDimensions: true,
  glovesPhysical: true,
  innerUnitsDispensing: true,
  pouches: false,
  pouchesDyeLeak: false,
};

const GLOVE_TYPE: CustomModuleSpec = {
  key: "glove_type",
  title: "Glove Type",
  after: "header",
  layout: "fields",
  fields: [
    {
      key: "gloveType",
      label: "Glove Type",
      type: "text",
      hint: "As on the onsite form's Purchase Order / Shipment Information.",
    },
  ],
};

/* ------------------------------------------------------------------ *
 * STD_EG: reports/STD_EG.md, onsite/EG.md
 * ------------------------------------------------------------------ */

/** Dimension specs printed on the STD_EG report (page 2). */
export const STD_EG_DIMENSION_SPECS: SizeSpecs<Measure> = {
  XS: { length: min(240), width: max(80), fingerThickness: NA, palmThickness: NA, cuffThickness: NA },
  S: { length: min(240), width: tol(80, 10), fingerThickness: NA, palmThickness: NA, cuffThickness: NA },
  M: { length: min(240), width: tol(95, 10), fingerThickness: NA, palmThickness: NA, cuffThickness: NA },
  L: { length: min(240), width: tol(110, 10), fingerThickness: NA, palmThickness: NA, cuffThickness: NA },
  XL: { length: min(240), width: min(110), fingerThickness: NA, palmThickness: NA, cuffThickness: NA },
};

const STD_EG: TemplateSpec = {
  code: "STD_EG",
  name: "Standard examination gloves (EN 455)",
  extends: null,
  scope: { productType: "examination", standard: "EN455", clientScoped: false },
  builtFrom: ["report_STD_EG", "onsite_EG"],
  unit: "pcs",
  sizes: EG_SIZES,
  report: {
    titleLines: ["Preshipment Inspection", "Nitrile Disposable Examination Gloves"],
    showClientLogo: false,
    pageHeader: "Pre-shipment Inspection : {po} {product}",
  },
  modules: [
    {
      key: "header",
      config: { fields: { ...allOn(HEADER_FIELDS), inspector: false }, mfgExpiryPrecision: "day" },
    },
    { key: "glove_info", config: { fields: allOn(GLOVE_INFO_FIELDS), indicativeWeightSize: "M" } },
    { key: "order_lots", config: { fields: { packingSite: false } } },
    { key: "packing_config", config: { innerUnit: "inner_box", fields: { packingMode: true } } },
    { key: "sampling_plan", config: { columns: STD_EG_SAMPLING_COLUMNS, inspectionLevel: "I" } },
    { key: "carton_sampling", config: {} },
    {
      key: "dimensions",
      config: {
        measures: MEASURES,
        statistic: "median",
        specs: STD_EG_DIMENSION_SPECS,
        decimals: { length: 0, width: 0, fingerThickness: 2, palmThickness: 2, cuffThickness: 2 },
        rows: 13,
      },
    },
    { key: "force_at_break", config: { n: 13, specMin: 6, standardLabel: null, decimals: 3 } },
    { key: "weight", config: { n: 13, specs: null, warnThresholdPct: 10, decimals: 2 } },
    {
      key: "watertight",
      config: { aql: WATERTIGHT_AQL, locations: listItems(WATERTIGHT_LOCATIONS.STD_EG), handSplit: false },
    },
    { key: "visual", config: { handSplit: false, classes: visualClasses("STD_EG") } },
    {
      key: "dispensing_packing",
      config: {
        minLayeringPct: 70,
        minDispensingPct: 80,
        stickinessCodes: stickinessCodes(),
        boxesPerSize: { default: 13, bySize: { XL: 5 } },
      },
    },
    {
      key: "labeling",
      config: {
        levels: {
          inner: { include: true, n: 3, checks: LABELLING_CHECK_LISTS.STD_EG.inner },
          carton: { include: true, n: 1, checks: LABELLING_CHECK_LISTS.STD_EG.carton },
        },
      },
    },
    { key: "conclusion", config: {} },
  ],
  customModules: [GLOVE_TYPE],
  toConfirm: [
    {
      path: "sampling_plan.inspectionLevel",
      note: "Level I: the example's samples match it. BUILD_SPEC 13 asks for the inspection level per client.",
    },
    { path: "dimensions.specs", note: "The example report's specs. BUILD_SPEC 13: spec limits per product." },
    {
      path: "dimensions.decimals",
      note: "As printed: 0 for length and width, 2 for thickness. lib/stats judges the shown (rounded) value: confirm.",
    },
    {
      path: "visual.classes",
      note: "The example report's lists and severities. BUILD_SPEC 13: final defect lists and severities per client.",
    },
    {
      path: "dispensing_packing.boxesPerSize",
      note: "13 per size and 5 in the XL block, as printed. The sampling plan's inner box count sets the rows when entered.",
    },
    {
      path: "force_at_break.n",
      note: "The report prints only the median; the 13 readings come from the lab report (rule 6.2.2 computes the median).",
    },
  ],
};

/* ------------------------------------------------------------------ *
 * SAFEDON_EG: reports/SAFEDON_EG.md, onsite/SAFEDON_EG.md (extends STD_EG)
 * ------------------------------------------------------------------ */

/** Dimension specs printed on the SAFEDON_EG report (page 2): XS to L, the sizes ordered. */
export const SAFEDON_EG_DIMENSION_SPECS: SizeSpecs<Measure> = {
  XS: { length: min(230), width: tol(76, 4), fingerThickness: tol(0.18, 0.04), palmThickness: tol(0.14, 0.04) },
  S: { length: min(230), width: tol(86, 4), fingerThickness: tol(0.18, 0.04), palmThickness: tol(0.14, 0.04) },
  M: { length: min(230), width: tol(98, 4), fingerThickness: tol(0.18, 0.04), palmThickness: tol(0.14, 0.04) },
  L: { length: min(230), width: tol(107, 4), fingerThickness: tol(0.18, 0.04), palmThickness: tol(0.14, 0.04) },
};

function stdEgConfig<M extends ModuleKey>(key: M): ModuleConfigValues[M] {
  const found = STD_EG.modules.find((module) => module.key === key);
  if (!found) throw new Error(`STD_EG has no module ${key}`);
  return found.config as ModuleConfigValues[M];
}

const SAFEDON_EG: TemplateSpec = {
  code: "SAFEDON_EG",
  name: "Safedon examination gloves (ASTM D6319)",
  extends: "STD_EG",
  scope: { productType: "examination", standard: "ASTM_D6319", clientScoped: true },
  builtFrom: ["report_SAFEDON_EG", "onsite_SAFEDON_EG"],
  unit: "pcs",
  sizes: EG_SIZES,
  report: {
    titleLines: ["Preshipment Inspection", "Safedon Nitrile PF Exam Gloves"],
    showClientLogo: true,
    pageHeader: "Preshipment Report (PO# {po}: {product})",
  },
  modules: [
    {
      key: "header",
      config: {
        fields: { ...allOn(HEADER_FIELDS), client: false, factoryGloveCode: false },
        mfgExpiryPrecision: "month",
      },
    },
    { key: "glove_info", config: stdEgConfig("glove_info") },
    { key: "order_lots", config: { fields: { packingSite: true } } },
    { key: "packing_config", config: { innerUnit: "plastic_pack", fields: { packingMode: true } } },
    { key: "sampling_plan", config: stdEgConfig("sampling_plan") },
    { key: "carton_sampling", config: {} },
    {
      key: "dimensions",
      config: {
        measures: ["length", "width", "fingerThickness", "palmThickness"],
        statistic: "average",
        specs: SAFEDON_EG_DIMENSION_SPECS,
        decimals: { length: 0, width: 0, fingerThickness: 2, palmThickness: 2 },
        rows: 13,
      },
    },
    {
      key: "tensile",
      config: {
        tensileMin: 14,
        elongationMin: 500,
        standardLabel: "ASTM D6319",
        decimals: { tensileStrength: 2, elongationAtBreak: 0 },
      },
    },
    { key: "weight", config: { n: 1, specs: { XS: NA, S: NA, M: NA, L: NA }, warnThresholdPct: 10, decimals: 2 } },
    {
      key: "watertight",
      config: { aql: WATERTIGHT_AQL, locations: listItems(WATERTIGHT_LOCATIONS.SAFEDON_EG), handSplit: false },
    },
    { key: "visual", config: { handSplit: false, classes: visualClasses("SAFEDON_EG") } },
    {
      key: "dispensing_safedon",
      config: {
        defects: safedonDefectItems(),
        glovesPerPack: 125,
        maxRatePct: 5,
        boxesPerSize: { default: 13 },
      },
    },
    {
      key: "labeling",
      config: {
        levels: {
          inner: { include: true, n: 3, checks: LABELLING_CHECK_LISTS.SAFEDON_EG.inner },
          carton: { include: true, n: 1, checks: LABELLING_CHECK_LISTS.SAFEDON_EG.carton },
        },
      },
    },
    { key: "conclusion", config: {} },
  ],
  customModules: [GLOVE_TYPE],
  toConfirm: [
    {
      path: "scope.clientScoped",
      note: "BUILD_SPEC 13: confirm the client (the report carries its logo) and whether the Safedon dispensing check applies to all its products.",
    },
    {
      path: "sampling_plan.inspectionLevel",
      note: "Level I raises the below-plan notice of expected-results A; the example sampled 80 and 200 where level I gives 200 and 500. BUILD_SPEC 13.",
    },
    { path: "dimensions.specs", note: "The example's specs, XS to L: no XL spec is printed. BUILD_SPEC 13: spec limits per product." },
    { path: "weight.specs", note: "NA as printed for XS to L; XL is not printed." },
    { path: "header.mfgExpiryPrecision", note: "The report prints month and year only: confirm month precision." },
    { path: "visual.classes", note: "BUILD_SPEC 13: final defect lists and severities per client." },
    {
      path: "dispensing_safedon.glovesPerPack",
      note: "125, the same number as packing_config glovesPerInner (125 per plastic pack): confirm which one the rate uses if they differ.",
    },
  ],
};

/* ------------------------------------------------------------------ *
 * STD_SG: onsite/SG.md only, no filled report
 * ------------------------------------------------------------------ */

const STD_SG: TemplateSpec = {
  code: "STD_SG",
  name: "Standard sterile surgical gloves",
  extends: null,
  scope: { productType: "surgical", standard: null, clientScoped: false },
  builtFrom: ["onsite_SG"],
  unit: "pairs",
  sizes: sizes("5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"),
  report: { titleLines: null, showClientLogo: false, pageHeader: null },
  modules: [
    {
      key: "header",
      config: {
        fields: { ...allOn(HEADER_FIELDS), factoryAddress: false, client: false, factoryGloveCode: false },
        mfgExpiryPrecision: "day",
      },
    },
    { key: "order_lots", config: { fields: { packingSite: false } } },
    { key: "packing_config", config: { innerUnit: "pouch", fields: { packingMode: true } } },
    {
      key: "sampling_plan",
      config: {
        columns: {
          cases: true,
          innerUnits: true,
          gloves: false,
          glovesWatertightVisual: true,
          glovesDimensions: true,
          glovesPhysical: true,
          innerUnitsDispensing: false,
          pouches: true,
          pouchesDyeLeak: true,
        },
        inspectionLevel: null,
      },
    },
    {
      key: "watertight",
      config: { aql: WATERTIGHT_AQL, locations: listItems(WATERTIGHT_LOCATIONS.STD_SG), handSplit: true },
    },
    { key: "visual", config: { handSplit: true, classes: visualClasses("STD_SG") } },
    { key: "dimensions", config: { measures: MEASURES, statistic: null, specs: null, decimals: {}, rows: 13 } },
    { key: "dye_leak", config: { n: null } },
    { key: "conclusion", config: {} },
  ],
  customModules: [GLOVE_TYPE],
  toConfirm: [
    { path: "scope.standard", note: "No filled SG report: EN 455 or ASTM D3577." },
    { path: "unit", note: "pairs (sterile surgical gloves are packed in pairs); the SG form counts '# gloves'." },
    { path: "sizes", note: "The form has 8 size columns with blank headings: 5.5 to 9.0 assumed." },
    { path: "report.titleLines", note: "No filled SG report." },
    { path: "header.fields", note: "The SG form has no factory address, client or factory glove code: off." },
    {
      path: "packing_config.innerUnit",
      note: "pouch (BUILD_SPEC 11); the SG sampling plan counts both Inner Box and Pouches, so a second packing level may be needed.",
    },
    { path: "sampling_plan.inspectionLevel", note: "Not on the form." },
    { path: "watertight.locations", note: "The form has 7 blank rows: STD_EG's locations until confirmed. AQL 1.5 is the default." },
    {
      path: "watertight.handSplit",
      note: "R and L per size as on the form; tested and the limits per size (the sampling plan has one '# gloves' per size).",
    },
    {
      path: "visual.classes",
      note: "Blank rows on the form: STD_EG's lists and the default AQLs until confirmed. The form has no critical class; it is on as in both reports.",
    },
    { path: "dimensions.statistic", note: "Planned only on the form: measures, statistic, specs and decimals to confirm." },
    { path: "dimensions.specs", note: "No SG spec yet. BUILD_SPEC 13." },
    { path: "dye_leak.n", note: "Planned only on the form ('# pouches (dye leak test)')." },
    {
      path: "modules",
      note: "BUILD_SPEC 11 does not switch force_at_break on, although the form plans '# Gloves (FAB)'.",
    },
  ],
};

export const TEMPLATES: Readonly<Record<TemplateCode, TemplateSpec>> = { STD_EG, SAFEDON_EG, STD_SG };

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export function templateModuleKeys(template: TemplateCode): ModuleKey[] {
  return TEMPLATES[template].modules.map((module) => module.key);
}

export function moduleConfig<M extends ModuleKey>(template: TemplateCode, key: M): ModuleConfigValues[M] | undefined {
  const found = TEMPLATES[template].modules.find((module) => module.key === key);
  return found?.config as ModuleConfigValues[M] | undefined;
}

/** The template a source document seeds (BUILD_SPEC 11, "Built from"). */
export function templateOfSource(source: SourceId): TemplateCode {
  const code = (Object.keys(TEMPLATES) as TemplateCode[]).find((template) =>
    TEMPLATES[template].builtFrom.includes(source),
  );
  if (!code) throw new Error(`No template is built from ${source}`);
  return code;
}

/**
 * Label overrides of one module in one template, against the module's
 * defaults (STD_EG wording): data field keys, `<field>.<group>` for class
 * or level labels, and caption keys. Empty for STD_EG by construction.
 */
export function labelOverrides(template: TemplateCode, module: ModuleKey): Record<string, string> {
  const spec = moduleSpec(module);
  const overrides: Record<string, string> = {};
  for (const field of spec.data) {
    const label = fieldLabel(template, module, field.key);
    if (label !== undefined && label !== field.label) overrides[field.key] = label;
    for (const [group, groupLabel] of Object.entries(field.groupLabels ?? {})) {
      const value = fieldLabel(template, module, field.key, group);
      if (value !== undefined && value !== groupLabel.label) overrides[`${field.key}.${group}`] = value;
    }
  }
  for (const caption of spec.labels) {
    const label = captionLabel(template, module, caption.key);
    if (label !== undefined && label !== caption.label) overrides[caption.key] = label;
  }
  return overrides;
}

/**
 * The template's modules as BUILD_SPEC 4.3 ModuleConfig values, resolved
 * (no inheritance): what a seed writes, before diffing against `extends`.
 */
export function seedModuleConfigs(template: TemplateCode) {
  return TEMPLATES[template].modules.map((module) => ({
    key: module.key,
    include: true,
    title: moduleTitle(template, module.key),
    labels: labelOverrides(template, module.key),
    config: module.config,
  }));
}
