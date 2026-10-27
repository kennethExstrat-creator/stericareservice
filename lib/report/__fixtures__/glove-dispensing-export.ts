// Exports for Section 07's Glove Dispensing tests (a Safedon template): the
// SAFEDON_EG example (./exports.ts; placeholder identifiers,
// docs/FIXTURES.md) with its order, its sampling plan, its sampled
// box/carton numbers and its Safedon dispensing data made over for the sizes
// a test needs, then run through the real modules and the export's own
// assembly, so the computed values and results are the module's own.
// Box/carton numbers are made up here (from 8,001 up), never a client's;
// counts are the tests' own.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { safedonRecord } from "./exports";

/** A box as entered: its box/carton number, and its counts by defect code (a code not counted is absent). */
export type DispensingBoxInput = { boxNo?: number | null; counts?: Readonly<Record<string, number>> };

export type DispensingSizeInput = {
  boxes: readonly DispensingBoxInput[];
  /** Boxes planned (the sampling plan's inner units for dispensing): as many as the boxes given unless set. */
  planned?: number;
  /** The size's sampled box/carton numbers: the boxes' own unless set. */
  sampled?: readonly number[];
  /** Cartons ordered: 100 unless given. */
  cases?: number;
};

export type DispensingExportOptions = {
  /** Over the template's config for the module: the maximum rate, the gloves per pack, the defects. */
  config?: Readonly<Record<string, unknown>>;
  /** Over the template's labels for the module: a template's own wording. */
  labels?: Readonly<Record<string, string>>;
  /** Over the report's options. */
  report?: Readonly<Record<string, unknown>>;
};

/** `count` boxes numbered from `first` by sevens (placeholders), nothing counted unless `counts` says. */
export function dispensingBoxes(count: number, first = 8001, counts: Readonly<Record<string, number>> = {}): DispensingBoxInput[] {
  return Array.from({ length: count }, (_, index) => ({ boxNo: first + index * 7, counts }));
}

type ModuleData = Record<string, Record<string, unknown>>;

/** A module's data by size, made where it is missing. */
function sizesOf(modules: ModuleData, key: string): Record<string, Record<string, unknown>> {
  modules[key] ??= {};
  return (modules[key].sizes ??= {}) as Record<string, Record<string, unknown>>;
}

/** SAFEDON_EG ordering these sizes (each sampled as size M is, its boxes planned as given), its Safedon dispensing as given. */
export function dispensingExport(sizes: Readonly<Record<string, DispensingSizeInput>>, options: DispensingExportOptions = {}): InspectionExport {
  const record = safedonRecord();
  const data = structuredClone(record.data) as { modules: ModuleData; custom: unknown };
  const { modules } = data;
  const plan = sizesOf(modules, "sampling_plan");
  const model = { ...plan.M };
  for (const key of ["order_lots", "sampling_plan", "carton_sampling", "dispensing_safedon"]) modules[key].sizes = {};
  const order = sizesOf(modules, "order_lots");
  const sampling = sizesOf(modules, "sampling_plan");
  const cartons = sizesOf(modules, "carton_sampling");
  const dispensing = sizesOf(modules, "dispensing_safedon");
  for (const [size, input] of Object.entries(sizes)) {
    order[size] = { qtyCases: input.cases ?? 100, lotNumbers: [], packingSite: null };
    sampling[size] = { ...model, innerUnitsDispensing: input.planned ?? input.boxes.length };
    const numbers = input.boxes.flatMap((box) => (typeof box.boxNo === "number" ? [box.boxNo] : []));
    cartons[size] = { cartonNumbers: [...(input.sampled ?? numbers)] };
    dispensing[size] = { boxes: input.boxes.map((box) => ({ boxNo: box.boxNo ?? null, counts: { ...box.counts } })) };
  }
  const resolved = structuredClone(record.template?.resolved) as ResolvedTemplate;
  const safedon = resolved.modules.find((module) => module.key === "dispensing_safedon");
  if (!safedon) throw new Error("The SAFEDON_EG template has no Safedon dispensing check.");
  safedon.config = { ...safedon.config, ...(options.config as typeof safedon.config) };
  safedon.labels = { ...safedon.labels, ...options.labels };
  const template = record.template && { ...record.template, resolved };
  const doc = exportOf({ ...record, data, template });
  return options.report ? ExportSchema.parse({ ...doc, report: { ...doc.report, ...options.report } }) : doc;
}

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

/** The six Safedon defects' codes, as the template lists them. */
export const SAFEDON_CODES = ["no_cuff", "finger_out", "multiple_out", "stuck", "sticky", "faulty_cuff"] as const;
