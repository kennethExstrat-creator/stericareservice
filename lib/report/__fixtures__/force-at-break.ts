// Exports for Section 05's tests (lib/report/sections/forceAtBreak.ts and
// its pages): the STD_EG example inspection (placeholders only,
// docs/FIXTURES.md) ordered in the sizes given, each with its force at break
// readings as a lab report prints them, run through the real modules and the
// export's own assembly, so the medians, verdicts and lab report state are
// the modules' own. The readings are made up for the tests.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { STD_EG_IDS, stdEgInspectionData, stdEgRecord, stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";

export type ForceSetup = {
  /** Each ordered size's readings in newtons, in test order; null for one not entered yet. */
  readings: Readonly<Record<string, readonly (number | null)[]>>;
  /** The order's lots per size; "LOT-<size>1" when left out, none for an empty list. */
  lots?: Readonly<Record<string, readonly string[]>>;
  /** Over the template's force at break config (STD_EG: 13 specimens, 6 N, no standard, 3 decimals). */
  config?: Partial<{ n: number; specMin: number; standardLabel: string | null; decimals: number }>;
  /** The sampling plan's gloves for the test, every size; the plan's own (13) when left out, the config's n with null. */
  physical?: number | null;
  /** The sizes the one lab report gives results for; every size when left out; null for no lab report. */
  labReportSizes?: readonly string[] | null;
};

const EXPORTED_AT = "2025-04-12T09:15:00.000Z";

/** The STD_EG inspection ordered in `setup.readings`' sizes, as its export reads. */
export function forceExport(setup: ForceSetup): InspectionExport {
  const sizes = Object.keys(setup.readings);
  const withReport = setup.labReportSizes !== null;
  const data = stdEgInspectionData({ labReportFileId: withReport ? STD_EG_IDS.fileLabReport : null });
  const modules = { ...data.modules } as Record<string, Record<string, unknown>>;
  const planRow = (modules.sampling_plan.sizes as Record<string, Record<string, unknown>>).M;
  modules.order_lots = {
    sizes: Object.fromEntries(sizes.map((size) => [size, { qtyCases: 100, lotNumbers: [...(setup.lots?.[size] ?? [`LOT-${size}1`])], packingSite: null }])),
  };
  modules.sampling_plan = {
    ...modules.sampling_plan,
    sizes: Object.fromEntries(sizes.map((size) => [size, { ...planRow, glovesPhysical: setup.physical === undefined ? planRow.glovesPhysical : setup.physical }])),
  };
  modules.force_at_break = {
    sizes: Object.fromEntries(sizes.map((size) => [size, { values: [...setup.readings[size]] }])),
    labReports: withReport ? [{ fileId: STD_EG_IDS.fileLabReport, sizes: [...(setup.labReportSizes ?? sizes)] }] : [],
  };
  const template = stdEgTemplate();
  template.modules = template.modules.map((module) => (module.key === "force_at_break" ? { ...module, config: { ...module.config, ...setup.config } } : module));
  const base = stdEgRecord();
  if (!base.template) throw new Error("The STD_EG fixture has no template row.");
  const record = stdEgRecord({
    data: { ...data, modules },
    template: { ...base.template, resolved: template },
    files: withReport ? base.files : [],
  });
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The force at break fixture does not evaluate: ${evaluation.message}`);
  const doc = assembleExport({
    record,
    evaluated: evaluation.evaluated,
    links: {
      photos: new Map(record.photos.map((photo) => [photo.storagePath, `https://storage.example.com/inspection-photos/${photo.id}.jpg`])),
      files: new Map(record.files.map((file) => [file.storagePath, `https://storage.example.com/inspection-files/${file.id}.pdf`])),
      clientLogo: null,
      sourceFile: null,
    },
    exportedAt: EXPORTED_AT,
  });
  return ExportSchema.parse(doc);
}

/**
 * Four sizes as the design lays them out: 13 readings each at 0.1 N, made
 * up, the medians 6.3, 6.5, 6.6 and 6.6 N, one size S specimen at 5.5 N,
 * and the standard EN 455-2.
 */
export const FOUR_SIZES: ForceSetup = {
  readings: {
    S: [6.5, 6.3, 6.1, 5.5, 6.6, 6.2, 6.8, 6.1, 6.4, 6.9, 6.3, 6.7, 6.2],
    M: [6.4, 6.8, 6.2, 6.6, 6.5, 7.0, 7.2, 6.1, 6.0, 6.3, 6.2, 6.5, 7.3],
    L: [6.3, 6.2, 6.2, 6.9, 6.6, 7.1, 6.0, 6.1, 6.6, 6.8, 6.7, 6.6, 6.1],
    XL: [6.5, 6.2, 7.0, 6.6, 7.1, 6.0, 6.1, 6.6, 6.2, 6.6, 6.4, 6.9, 6.6],
  },
  config: { standardLabel: "EN 455-2", decimals: 1 },
};
