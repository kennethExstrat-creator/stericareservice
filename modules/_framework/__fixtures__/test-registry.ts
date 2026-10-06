// Test doubles for the framework, template and validation tests: one small
// module per key, shaped like the real one will be. They are not the real
// modules (BUILD_SPEC 6.1) and do not change when those are built, so these
// tests keep testing the framework only.
import { z } from "zod";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { checkSpec, mean, statistic } from "@/lib/stats";
import {
  CartonNumberCellSchema,
  resultFromSizes,
  CountCellSchema,
  DecimalCellSchema,
  defineModule,
  errorIssue,
  INSPECTION_LEVELS,
  notDone,
  perSizeData,
  perSizeResults,
  SpecSchema,
  stubModule,
  suggestResult,
  TextCellSchema,
  warningIssue,
  type AnyModuleDefinition,
  type CalcIssue,
  type CalcOutput,
  type ModuleRegistry,
} from "@/modules/_framework";

export const TEST_CLIENT_ID = "20000000-0000-4000-8000-0000000000c1";
export const TEST_MANUFACTURER_ID = "10000000-0000-4000-8000-0000000000f1";
export const TEST_ADMIN_ID = "00000000-0000-4000-8000-000000000102";

const TITLES: Readonly<Record<ModuleKey, string>> = {
  header: "Manufacturer Information",
  glove_info: "Glove Information",
  order_lots: "Order",
  packing_config: "Packing configuration",
  sampling_plan: "Sampling Plan",
  carton_sampling: "Finished Goods Sampling Information (carton number)",
  dimensions: "Dimension",
  weight: "Weight (g)",
  force_at_break: "Force At Break in Newton",
  tensile: "Physical Properties",
  watertight: "Freedom from Holes by watertight test",
  visual: "Visual Inspection",
  dispensing_packing: "Glove Packing Check",
  dispensing_safedon: "Glove Dispensing Inspection",
  labeling: "Packaging Labeling Inspection",
  conclusion: "Conclusion",
  dye_leak: "Dye Leak Test",
  documents: "Documents",
  loading: "Loading",
};

const PER_SIZE: ReadonlySet<ModuleKey> = new Set([
  "dimensions",
  "force_at_break",
  "tensile",
  "watertight",
  "dispensing_packing",
  "dispensing_safedon",
  "labeling",
  "dye_leak",
]);

const header = defineModule({
  key: "header",
  title: TITLES.header,
  labels: { poNo: "PO / SO Number", productName: "Product Name (Brand, code & description)", client: "Client Name" },
  dataSchema: z.strictObject({ poNo: TextCellSchema, productName: TextCellSchema, client: TextCellSchema }),
  emptyData: () => ({ poNo: null, productName: null, client: null }),
  configSchema: z.strictObject({ fields: z.strictObject({ client: z.boolean() }) }),
  defaultConfig: { fields: { client: true } },
  canonicalPaths: [
    { path: "poNo", label: "PO / SO Number", type: "text" },
    { path: "productName", label: "Product Name", type: "text" },
  ],
  calc: ({ data }): CalcOutput => ({
    result: data.poNo && data.productName ? { status: "info", summary: `PO ${data.poNo}.` } : notDone("Missing PO."),
    computed: {},
    issues: [],
  }),
  contribute: ({ data }) => ({ header: { poNo: data.poNo, productName: data.productName, client: data.client } }),
});

const gloveInfo = defineModule({
  key: "glove_info",
  title: TITLES.glove_info,
  labels: { indicativeWeight: "Indicative weight (size M)", colour: "Glove colour" },
  dataSchema: z.strictObject({ indicativeWeight: DecimalCellSchema, colour: TextCellSchema }),
  emptyData: () => ({ indicativeWeight: null, colour: null }),
  configSchema: z.strictObject({ fields: z.strictObject({ indicativeWeight: z.boolean(), colour: z.boolean() }) }),
  defaultConfig: { fields: { indicativeWeight: true, colour: true } },
  canonicalPaths: [
    { path: "indicativeWeight", label: "Indicative weight", type: "number", unit: "g" },
    { path: "colour", label: "Glove colour", type: "text" },
  ],
  calc: ({ data }): CalcOutput => ({
    result: data.indicativeWeight === null ? notDone() : { status: "info", summary: "Glove information." },
    computed: {},
    issues: [],
  }),
  contribute: ({ data }) =>
    data.indicativeWeight === null ? {} : { indicativeWeight: { grams: data.indicativeWeight, size: "m" } },
});

const OrderLotSchema = z.strictObject({
  size: z.string(),
  qtyCases: CountCellSchema,
  lotNumbers: z.array(z.string()).default([]),
});

const orderLots = defineModule({
  key: "order_lots",
  title: TITLES.order_lots,
  labels: { qtyCases: "Qty (cases)", lotNumbers: "Lot Number" },
  dataSchema: z.strictObject({ lots: z.array(OrderLotSchema).default([]) }),
  emptyData: () => ({ lots: [] }),
  configSchema: z.strictObject({ packingSite: z.boolean() }),
  defaultConfig: { packingSite: false },
  calc: ({ data, context }): CalcOutput => {
    const ordered = data.lots.filter((lot) => (lot.qtyCases ?? 0) > 0);
    if (ordered.length === 0) return { result: notDone("No sizes ordered."), computed: {}, issues: [] };
    const totalCartons = ordered.reduce((sum, lot) => sum + (lot.qtyCases ?? 0), 0);
    const perCase = context.packing.glovesPerCase;
    return {
      result: { status: "info", summary: `${totalCartons} cartons.` },
      computed: { totalCartons, totalGloves: perCase === null ? null : totalCartons * perCase },
      issues: [],
    };
  },
  contribute: ({ data }) => ({
    sizes: data.lots.filter((lot) => (lot.qtyCases ?? 0) > 0).map((lot) => lot.size),
    order: Object.fromEntries(data.lots.map((lot) => [lot.size, { qtyCases: lot.qtyCases, lotNumbers: lot.lotNumbers }])),
  }),
});

const packing = defineModule({
  key: "packing_config",
  title: TITLES.packing_config,
  labels: { glovesPerInner: "# glove per inner box", innersPerCase: "# inners per case", glovesPerCase: "# gloves per case" },
  dataSchema: z.strictObject({
    glovesPerInner: CountCellSchema,
    innersPerCase: CountCellSchema,
    glovesPerCase: CountCellSchema,
  }),
  emptyData: () => ({ glovesPerInner: null, innersPerCase: null, glovesPerCase: null }),
  configSchema: z.strictObject({ innerUnit: z.string() }),
  defaultConfig: { innerUnit: "inner box" },
  calc: ({ data }): CalcOutput => {
    const { glovesPerInner, innersPerCase, glovesPerCase } = data;
    if (glovesPerInner === null || innersPerCase === null || glovesPerCase === null) {
      return { result: notDone(), computed: {}, issues: [] };
    }
    const expected = glovesPerInner * innersPerCase;
    if (expected === glovesPerCase) {
      return { result: { status: "info", summary: `${glovesPerCase} gloves per case.` }, computed: { expected }, issues: [] };
    }
    return {
      result: { status: "warn", summary: `${glovesPerCase} gloves per case, expected ${expected}.` },
      computed: { expected },
      issues: [warningIssue("gloves_per_case_mismatch", "Gloves per case is not inner x per case.", { path: ["glovesPerCase"] })],
    };
  },
  contribute: ({ data, config }) => ({ packing: { innerUnit: config.innerUnit, ...data } }),
});

const sampling = defineModule({
  key: "sampling_plan",
  title: TITLES.sampling_plan,
  perSize: true,
  labels: { cases: "Case", watertightVisual: "# gloves for watertight & Visual" },
  dataSchema: perSizeData(
    z.strictObject({ cases: CountCellSchema, watertightVisual: CountCellSchema, dimensions: CountCellSchema }),
  ),
  emptyData: () => ({ sizes: {} }),
  configSchema: z.strictObject({ inspectionLevel: z.enum(INSPECTION_LEVELS).nullable() }),
  defaultConfig: { inspectionLevel: null },
  calc: ({ data, context }): CalcOutput => {
    const perSize = perSizeResults(context.sizes, (size) =>
      data.sizes[size]?.cases ? { status: "info" } : { status: "not_done" },
    );
    return { result: resultFromSizes(perSize, "Sampling plan."), computed: {}, issues: [] };
  },
  contribute: ({ data, config }) => ({
    sampling: data.sizes,
    ...(config.inspectionLevel ? { aql: { inspectionLevel: config.inspectionLevel } } : {}),
  }),
});

const cartons = defineModule({
  key: "carton_sampling",
  title: TITLES.carton_sampling,
  perSize: true,
  labels: {},
  dataSchema: perSizeData(z.array(CartonNumberCellSchema)),
  emptyData: () => ({ sizes: {} }),
  configSchema: z.strictObject({}),
  defaultConfig: {},
  calc: ({ data, context }): CalcOutput => {
    const issues: CalcIssue[] = [];
    const perSize = perSizeResults(context.sizes, (size) => {
      const list = data.sizes[size] ?? [];
      if (list.every((carton) => carton === null)) return { status: "not_done" };
      const seen = new Set<number>();
      let duplicates = 0;
      list.forEach((carton, index) => {
        if (carton === null) return;
        if (seen.has(carton)) {
          duplicates += 1;
          issues.push(
            errorIssue("carton_duplicate", `Carton ${carton} is entered twice for size ${size}.`, {
              size,
              path: ["sizes", size, index],
            }),
          );
        }
        seen.add(carton);
      });
      return { status: duplicates > 0 ? "fail" : "pass" };
    });
    return { result: resultFromSizes(perSize, "Carton numbers."), computed: {}, issues };
  },
  contribute: ({ data }) => ({
    cartons: Object.fromEntries(
      Object.entries(data.sizes).map(([size, list]) => [size, list.filter((carton) => carton !== null)]),
    ),
  }),
});

// A spec per size and measure, as dimensions keeps them: a child template
// replaces a spec whole when it sets one (lib/templates/merge.ts).
const MeasureSpecsSchema = z.strictObject({ length: SpecSchema, width: SpecSchema }).partial();

const dimensions = defineModule({
  key: "dimensions",
  title: TITLES.dimensions,
  perSize: true,
  labels: { length: "Length", width: "Width" },
  dataSchema: perSizeData(z.strictObject({ width: z.array(DecimalCellSchema).default([]) })),
  emptyData: () => ({ sizes: {} }),
  configSchema: z.strictObject({
    statistic: z.enum(["median", "average"]),
    specs: z.record(CanonicalSizeSchema, MeasureSpecsSchema),
  }),
  defaultConfig: { statistic: "median", specs: {} },
  calc: ({ data, config, context }): CalcOutput => {
    const perSize = perSizeResults(context.sizes, (size) => {
      const values = (data.sizes[size]?.width ?? []).filter((value) => value !== null);
      const value = statistic(config.statistic, values);
      const spec = config.specs[size]?.width;
      if (value === null || !spec) return { status: "not_done" };
      const outcome = checkSpec(value, spec);
      return { status: outcome === "na" ? "info" : outcome };
    });
    return { result: resultFromSizes(perSize, "Dimension."), computed: {}, issues: [] };
  },
});

const weight = defineModule({
  key: "weight",
  title: TITLES.weight,
  perSize: true,
  labels: { average: "Average" },
  dataSchema: perSizeData(z.strictObject({ values: z.array(DecimalCellSchema).default([]) })),
  emptyData: () => ({ sizes: {} }),
  configSchema: z.strictObject({ n: z.number().int().min(1), warnThresholdPct: z.number().min(0) }),
  defaultConfig: { n: 13, warnThresholdPct: 10 },
  calc: ({ data, config, context }): CalcOutput => {
    const issues: CalcIssue[] = [];
    const averages: Record<string, number> = {};
    const perSize = perSizeResults(context.sizes, (size) => {
      const values = (data.sizes[size]?.values ?? []).filter((value) => value !== null);
      const average = mean(values);
      if (values.length < config.n || average === null) return { status: "not_done" };
      averages[size] = average;
      const indicative = context.indicativeWeight;
      if (!indicative || indicative.size !== size) return { status: "info" };
      const deviation = ((average - indicative.grams) / indicative.grams) * 100;
      if (Math.abs(deviation) <= config.warnThresholdPct) return { status: "pass" };
      issues.push(
        warningIssue(
          "weight_deviation",
          `Average ${average.toFixed(1)} g is ${Math.abs(deviation).toFixed(0)}% ${deviation < 0 ? "below" : "above"} the indicative ${indicative.grams} g.`,
          { size, path: ["sizes", size, "values"] },
        ),
      );
      return { status: "warn" };
    });
    return { result: resultFromSizes(perSize, "Weight."), computed: averages, issues };
  },
});

const DefectClassSchema = z.strictObject({ aql: z.number().min(0), defects: z.array(z.string()) });

const visual = defineModule({
  key: "visual",
  title: TITLES.visual,
  perSize: true,
  handSplit: true,
  // One wording per defect code, and per class where STD_EG words one defect twice.
  labels: {
    thin_spot: "Thin spot on glove body",
    stain: "Oil stain",
    bead_defective: "Defective bead",
    "minor.bead_defective": "Defective beads",
  },
  dataSchema: perSizeData(z.strictObject({ critical: CountCellSchema, major: CountCellSchema })),
  emptyData: () => ({ sizes: {} }),
  configSchema: z.strictObject({
    handSplit: z.boolean(),
    classes: z.strictObject({ critical: DefectClassSchema, major: DefectClassSchema, minor: DefectClassSchema }),
  }),
  defaultConfig: {
    handSplit: false,
    classes: {
      critical: { aql: 0, defects: ["embedded_insect", "embedded_metal"] },
      major: { aql: 2.5, defects: ["thin_spot", "stain", "bead_defective"] },
      minor: { aql: 4.0, defects: ["dirt_small", "bead_defective"] },
    },
  },
  calc: ({ data, context }): CalcOutput => {
    const perSize = perSizeResults(context.sizes, (size) => {
      const counts = data.sizes[size];
      if (!counts || counts.critical === null || counts.major === null) return { status: "not_done" };
      return { status: counts.critical > 0 ? "fail" : "pass" };
    });
    return { result: resultFromSizes(perSize, "Visual."), computed: {}, issues: [] };
  },
});

const conclusion = defineModule({
  key: "conclusion",
  title: TITLES.conclusion,
  dependsOn: "all",
  requiredForSubmit: true,
  labels: { finalResult: "Conclusion", remark: "Remark" },
  dataSchema: z.strictObject({
    finalResult: z.enum(["pass", "fail", "hold"]).nullable().default(null),
    remark: TextCellSchema,
  }),
  emptyData: () => ({ finalResult: null, remark: null }),
  configSchema: z.strictObject({}),
  defaultConfig: {},
  calc: ({ data, results }): CalcOutput => {
    const seen = Object.entries(results).flatMap(([key, result]) =>
      result ? [{ key: key as ModuleKey, status: result.status }] : [],
    );
    const computed = { suggestedResult: suggestResult(seen).result, seen: seen.map((entry) => entry.key).sort() };
    if (data.finalResult === null) return { result: notDone("No final result."), computed, issues: [] };
    const status = data.finalResult === "hold" ? "warn" : data.finalResult;
    return { result: { status, summary: `Final result: ${data.finalResult}.` }, computed, issues: [] };
  },
});

const stubs = Object.fromEntries(
  MODULE_KEYS.map((key) => [
    key,
    stubModule({ key, title: TITLES[key], perSize: PER_SIZE.has(key), handSplit: key === "watertight" }),
  ]),
) as Record<ModuleKey, AnyModuleDefinition>;

export const TEST_REGISTRY: ModuleRegistry = {
  ...stubs,
  header,
  glove_info: gloveInfo,
  order_lots: orderLots,
  packing_config: packing,
  sampling_plan: sampling,
  carton_sampling: cartons,
  dimensions,
  weight,
  visual,
  conclusion,
};

/** The registry with some modules replaced, e.g. one whose calc throws. */
export function registryWith(overrides: Partial<Record<ModuleKey, AnyModuleDefinition>>): ModuleRegistry {
  return { ...TEST_REGISTRY, ...overrides };
}
