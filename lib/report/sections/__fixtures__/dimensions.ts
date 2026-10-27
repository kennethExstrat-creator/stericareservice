// Exports for Sections 03 and 04's tests, from the placeholder example
// reports (docs/FIXTURES.md; never client data): the inspection's data
// changed first (more sizes, a spec set for this inspection, a P/F set by
// hand, readings left out), then run through the real modules and the
// export's own assembly, as lib/report/__fixtures__/exports.ts does, so the
// computed values are the modules' own.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import { stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { safedonRecord } from "@/lib/report/__fixtures__/exports";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";

/** The inspection's modules' data, by module key, as saved. */
export type ModuleData = Record<string, Record<string, unknown>>;

function exportOf(record: InspectionRecord): InspectionExport {
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The fixture does not evaluate: ${evaluation.message}`);
  return ExportSchema.parse(
    assembleExport({
      record,
      evaluated: evaluation.evaluated,
      links: { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null },
      exportedAt: "2025-02-20T09:00:00.000Z",
    }),
  );
}

function withData(record: InspectionRecord, edit: (modules: ModuleData) => void): InspectionExport {
  const data = structuredClone(record.data) as { modules: ModuleData };
  edit(data.modules);
  return exportOf({ ...record, data });
}

/** STD_EG (size M, by median; length ≥ 240, width to each size's tolerance, thickness NA) with its data changed first. */
export function stdEgWith(edit: (modules: ModuleData) => void): InspectionExport {
  return withData(stdEgRecord(), edit);
}

/** SAFEDON_EG (sizes XS to L, by average; no cuff; every measure judged) with its data changed first. */
export function safedonWith(edit: (modules: ModuleData) => void): InspectionExport {
  return withData(safedonRecord(), edit);
}

/** A module's data by size, made where it is missing. */
export function sizesOf(modules: ModuleData, key: string): Record<string, Record<string, unknown>> {
  modules[key] ??= {};
  return (modules[key].sizes ??= {}) as Record<string, Record<string, unknown>>;
}

/** Thirteen gloves' lengths from how many read each length: { 242: 6, 243: 7 }. */
export function lengthsFrom(counts: Readonly<Record<number, number>>): number[] {
  return Object.entries(counts).flatMap(([value, count]) => Array.from({ length: count }, () => Number(value)));
}

/** The lengths each size reads on STD_EG's four sizes: up to six gloves of one length, as the design's page has them. */
export const FOUR_SIZE_LENGTHS: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  S: { 242: 6, 243: 3, 244: 2, 245: 2 },
  M: { 242: 4, 243: 1, 244: 5, 245: 2, 246: 1 },
  L: { 242: 3, 243: 3, 244: 6, 245: 1 },
  XL: { 242: 5, 243: 2, 244: 5, 245: 1 },
};

const FOUR_SIZE_WIDTHS: Readonly<Record<string, number>> = { S: 84, M: 95, L: 105, XL: 114 };
const FOUR_SIZE_WEIGHTS: Readonly<Record<string, number>> = { S: 3.2, M: 3.5, L: 3.8, XL: 4.2 };

/**
 * STD_EG ordered in sizes S to XL, the template's specs for each (width 80
 * ± 10 to 110 ± 10, XL at least 110): each size's 13 gloves, its weight
 * and its lot, the sampling plan as size M's.
 */
export function fourSizes(modules: ModuleData): void {
  const order = sizesOf(modules, "order_lots");
  const plan = sizesOf(modules, "sampling_plan");
  const dimensions = sizesOf(modules, "dimensions");
  const weight = sizesOf(modules, "weight");
  for (const [size, lot] of [
    ["S", "LOT-A02"],
    ["L", "LOT-A03"],
    ["XL", "LOT-A04"],
  ] as const) {
    order[size] = { qtyCases: 1000, lotNumbers: [lot], packingSite: null };
    plan[size] = { ...plan.M };
  }
  for (const [size, counts] of Object.entries(FOUR_SIZE_LENGTHS)) {
    dimensions[size] = {
      gloves: lengthsFrom(counts).map((length, index) => ({
        length,
        width: FOUR_SIZE_WIDTHS[size] + (index % 3) - 1,
        fingerThickness: index % 2 === 0 ? 0.1 : 0.11,
        palmThickness: index % 2 === 0 ? 0.06 : 0.07,
        cuffThickness: 0.05,
      })),
    };
    weight[size] = { values: [FOUR_SIZE_WEIGHTS[size]] };
  }
}

/** SAFEDON_EG with size XL on the order too: 13 gloves, sampled as size L, and no spec for it in the template. */
export function withSizeXL(modules: ModuleData): void {
  sizesOf(modules, "order_lots").XL = { qtyCases: 40, lotNumbers: ["LOT-B05"], packingSite: "Packer C" };
  const plan = sizesOf(modules, "sampling_plan");
  plan.XL = { ...plan.L };
  sizesOf(modules, "dimensions").XL = {
    gloves: lengthsFrom({ 243: 2, 244: 6, 245: 3, 246: 2 }).map((length, index) => ({
      length,
      width: 112 + (index % 3),
      fingerThickness: 0.17,
      palmThickness: 0.12,
      cuffThickness: null,
    })),
  };
  sizesOf(modules, "weight").XL = { values: [3.9] };
}

/** SAFEDON_EG with size S's length judged against at least 245 mm for this inspection, and size M's width failed by hand. */
export function failingSafedon(modules: ModuleData): void {
  const dimensions = sizesOf(modules, "dimensions");
  dimensions.S = { ...dimensions.S, specOverrides: { length: { kind: "min", min: 245 } } };
  dimensions.M = { ...dimensions.M, manualResults: { width: { result: "fail", comment: "Cuffs torn on three gloves." } } };
}
