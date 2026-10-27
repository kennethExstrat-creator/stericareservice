// The two example reports (tests/fixtures/examples) as whole inspections on
// the seed templates, for the Phase 2 acceptance test (BUILD_SPEC 12: both
// example reports give every result in docs/examples/expected-results.md,
// including the corrected values and the validation errors).
//
// Each report section is entered the way the capture screen stores it, into
// the module the section feeds (SECTION_MODULE), as module data under
// data.modules; then the inspection is evaluated exactly as the capture
// screen, submit, the review and the export do (docs/MODULES.md section 13):
// the template the report was made on (`seedTemplate`), buildInspectionView
// (the context, and the titles as the inspection shows them),
// validateInspection.
//
// What the reports do not print is entered the way docs/FIXTURES.md ("How
// the acceptance tests use them") says: 13 force readings whose median is
// the printed 6.537 N, 13 weights of the printed 2.90 g average, and an aged
// sample that passes for the packing check's size M (the report predates
// it, and every size needs one: Kenneth, 27 October 2026). A cell the
// inspector typed as text is refused at the cell (6.2 rule 1), so it is
// stored as nothing until the corrected value is typed (`textCells`).
import { readFileSync } from "node:fs";
import { ResolvedTemplateSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { roundTo } from "@/lib/stats";
import { lookupFrom, resolveTemplateOrThrow } from "@/lib/templates";
import { STD_EG_REPORT_SEED } from "@/lib/templates/definitions";
import { validateInspection, type ValidationReport } from "@/lib/validation";
import {
  buildInspectionView,
  type InspectionContext,
  type InspectionData,
  type InspectionMeta,
  type ModuleEvaluation,
} from "@/modules/_framework";
import { TEST_INSPECTOR } from "@/modules/_framework/testing";
import { dimensionsData } from "@/modules/dimensions/__fixtures__/examples";
import { passingAgedSample } from "@/modules/dispensing_packing/__fixtures__/examples";
import { headerData, pickedDate } from "@/modules/header/__fixtures__/examples";
import { orderData } from "@/modules/order_lots/__fixtures__/examples";
import { packingData } from "@/modules/packing_config/__fixtures__/examples";
import { cartonSamplingData, samplingPlanData } from "@/modules/sampling_plan/__fixtures__/examples";
import { MODULE_REGISTRY } from "@/modules/registry";
import { weightData } from "@/modules/weight/__fixtures__/examples";
import type { ModuleKey } from "@/lib/schemas/module-result";
import {
  intendedValue,
  isTextCell,
  SAFEDON_DEFECTS,
  SAFEDON_EG_EXAMPLE,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
  type NumberCell,
  type PerSize,
  type ReportSize,
  type SafedonEgExample,
  type StdEgExample,
} from "@/tests/fixtures/examples";

/* ------------------------------------------------------------------ *
 * The templates, as seeded
 * ------------------------------------------------------------------ */

type BundleEntry = { code: string; resolved: unknown };

const BUNDLE = JSON.parse(
  readFileSync(new URL("../../lib/templates/definitions/seed-bundle.json", import.meta.url), "utf8"),
) as { templates: BundleEntry[] };

/**
 * The template an example report was made on. SAFEDON_EG and STD_SG are as
 * seeded (seed-bundle.json, which scripts/seed-templates.mts writes to
 * `templates.resolved`). STD_EG is as versions 1 to 4 have it, its report's
 * flow (STD_EG_REPORT_SEED): the STD_EG seed runs SAFEDON_EG's flow since 26
 * October 2026.
 */
export function seedTemplate(code: "STD_EG" | "SAFEDON_EG" | "STD_SG"): ResolvedTemplate {
  if (code === "STD_EG") {
    return resolveTemplateOrThrow(STD_EG_REPORT_SEED.definition(), { getBase: lookupFrom([]), registry: MODULE_REGISTRY });
  }
  const entry = BUNDLE.templates.find((candidate) => candidate.code === code);
  if (!entry) throw new Error(`seed-bundle.json has no ${code}`);
  return ResolvedTemplateSchema.parse(entry.resolved);
}

/* ------------------------------------------------------------------ *
 * The inspection row
 * ------------------------------------------------------------------ */

export const MANUFACTURER_ID = "00000000-0000-4000-8000-000000000201";
export const CLIENT_ID = "00000000-0000-4000-8000-000000000301";
/** The tensile lab report's inspection_files row (placeholder id). */
export const TENSILE_LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

/**
 * What the inspection row holds: the manufacturer and client picked on
 * /inspections/new, the logged-in inspector, the reference number, and the
 * files uploaded (the tensile lab report on SAFEDON_EG).
 */
export function inspectionMeta(example: ExampleReport, files: InspectionMeta["files"] = []): InspectionMeta {
  const { header } = example;
  const manufacturer = header.factory ? `${header.manufacturer} (${header.factory})` : header.manufacturer;
  const client = header.client ?? header.clientLogo ?? null;
  return {
    refNo: example.template === "STD_EG" ? "INS-2026-0001" : "INS-2026-0002",
    inspectionDate: header.inspectionDate.iso,
    inspector: { ...TEST_INSPECTOR },
    manufacturer: { id: MANUFACTURER_ID, name: manufacturer },
    client: client === null ? null : { id: CLIENT_ID, name: client },
    files,
  };
}

/* ------------------------------------------------------------------ *
 * Sections as module data
 * ------------------------------------------------------------------ */

/** Sizes a section filled in, in the report's order. */
function filled<T>(perSize: PerSize<T>): [ReportSize, T][] {
  return (["XS", "S", "M", "L", "XL"] as const).flatMap((size) => {
    const entry = perSize[size];
    return entry === undefined ? [] : [[size, entry] as [ReportSize, T]];
  });
}

function bySize<T, U>(perSize: PerSize<T>, map: (entry: T, size: ReportSize) => U): Record<string, U> {
  return Object.fromEntries(filled(perSize).map(([size, entry]) => [size, map(entry, size)]));
}

/**
 * How a cell the inspector typed as text ends up stored: "refused", as the
 * numeric cell does with "2 42" (6.2 rule 1), leaves it empty until the
 * corrected value is typed; "corrected" stores that value.
 */
export type TextCells = "refused" | "corrected";

function readCell(textCells: TextCells) {
  return (cell: NumberCell): number | null => (isTextCell(cell) && textCells === "refused" ? null : intendedValue(cell));
}

function gloveInfoData(example: ExampleReport) {
  const { surfaceTexture, indicativeWeightG, colour, length } = example.gloveInfo;
  return { surfaceTexture, indicativeWeight: indicativeWeightG, colour, length };
}

function watertightData(example: ExampleReport) {
  return {
    sizes: bySize(example.watertight.perSize, (entry) => ({
      tested: entry.tested,
      holes: { ...entry.holes },
      otherDescription: null,
      unmapped: [],
    })),
  };
}

function visualData(example: ExampleReport) {
  const sizes = new Set<ReportSize>(
    (["critical", "major", "minor"] as const).flatMap((cls) => filled(example.visual[cls].perSize).map(([size]) => size)),
  );
  const classData = (cls: "critical" | "major" | "minor", size: ReportSize) => {
    const entry = example.visual[cls].perSize[size];
    return { inspected: entry?.inspected ?? null, counts: { ...entry?.counts }, unmapped: [] };
  };
  return {
    sizes: Object.fromEntries(
      [...sizes].map((size) => [
        size,
        { critical: classData("critical", size), major: classData("major", size), minor: classData("minor", size) },
      ]),
    ),
  };
}

function labelingData(example: ExampleReport) {
  const level = (entry: { inspected: number; defects: Readonly<Record<string, number | undefined>> } | undefined) => ({
    inspected: entry?.inspected ?? null,
    boxNos: [],
    defects: { ...entry?.defects },
  });
  return {
    sizes: bySize(example.labeling.inner.perSize, (_, size) => ({
      inner: level(example.labeling.inner.perSize[size]),
      carton: level(example.labeling.carton.perSize[size]),
    })),
  };
}

function conclusionData(example: ExampleReport) {
  return {
    // The inspector's decision as the report printed it.
    finalResult: example.conclusion.printedResult === "PASSED" ? "pass" : "fail",
    remark: example.conclusion.remark,
    date: pickedDate(example.conclusion.date),
    signature: null,
  };
}

/**
 * n readings (n odd) whose median is exactly `value`, out of order: STD_EG
 * prints only the median, so any readings with that median stand in for the
 * lab report's (docs/FIXTURES.md, "How the acceptance tests use them" 6).
 */
export function readingsWithMedian(value: number, n = 13): number[] {
  const middle = (n - 1) / 2;
  const sorted = Array.from({ length: n }, (_, index) => roundTo(value + (index - middle) * 0.05, 6));
  return [...sorted.filter((_, index) => index % 2 === 1), ...sorted.filter((_, index) => index % 2 === 0)];
}

/* ------------------------------------------------------------------ *
 * STD_EG
 * ------------------------------------------------------------------ */

export type StdEgOptions = {
  /** Apply STD_EG_EXPECTED.corrections: the duplicate carton. */
  corrected?: boolean;
};

/** The STD_EG example as saved inspection data, as entered (the report's error kept) or corrected. */
export function stdEgData({ corrected = false }: StdEgOptions = {}): InspectionData {
  const report: StdEgExample = STD_EG_EXAMPLE;
  const cartons = cartonSamplingData(report);
  const packing = report.dispensingPacking.perSize;
  const boxes = bySize(packing, (entry) => ({
    boxes: entry.boxes.map((box) => ({
      boxNo: box.box,
      layeringPct: box.layeringPct,
      dispensingPct: box.dispensingPct,
      stickiness: box.stickiness,
      note: null,
    })),
    // Not on the report: a placeholder that passes.
    agedSample: passingAgedSample(),
  }));
  if (corrected) {
    const { duplicateCarton } = STD_EG_EXPECTED.corrections;
    const index = (duplicateCarton.cell.row - 1) * 10 + (duplicateCarton.cell.column - 1);
    const list = cartons.sizes[duplicateCarton.size].cartonNumbers;
    if (list[index] !== duplicateCarton.from) throw new Error("The duplicate carton is not where the fixture says.");
    list[index] = duplicateCarton.to;
  }
  return {
    modules: {
      header: headerData(report.header),
      glove_info: gloveInfoData(report),
      order_lots: orderData(report.order),
      packing_config: packingData(report.packing),
      sampling_plan: samplingPlanData(report),
      carton_sampling: cartons,
      dimensions: dimensionsData(report.dimensions),
      force_at_break: {
        sizes: bySize(report.forceAtBreak, (entry) => ({ values: readingsWithMedian(entry.medianN) })),
        labReports: [],
      },
      weight: weightData(report.weight),
      watertight: watertightData(report),
      visual: visualData(report),
      dispensing_packing: { sizes: boxes },
      labeling: labelingData(report),
      conclusion: conclusionData(report),
    },
    custom: {},
  };
}

/* ------------------------------------------------------------------ *
 * SAFEDON_EG
 * ------------------------------------------------------------------ */

export type SafedonEgOptions = {
  /** The five dimension cells typed with a space: refused at the cell, or typed again correctly. */
  textCells?: TextCells;
  /** The tensile lab report attached through the module's file slot. */
  labReport?: boolean;
};

/** The SAFEDON_EG example as saved inspection data. */
export function safedonEgData({ textCells = "corrected", labReport = true }: SafedonEgOptions = {}): InspectionData {
  const report: SafedonEgExample = SAFEDON_EG_EXAMPLE;
  return {
    modules: {
      header: headerData(report.header),
      glove_info: gloveInfoData(report),
      order_lots: orderData(report.order),
      packing_config: packingData(report.packing),
      sampling_plan: samplingPlanData(report),
      carton_sampling: cartonSamplingData(report),
      dimensions: dimensionsData(report.dimensions, readCell(textCells)),
      tensile: {
        sizes: bySize(report.tensile, (entry) => ({
          tensileStrength: entry.tensileMPa,
          elongationAtBreak: entry.elongationPct,
        })),
        // Saved as before 26 October 2026, one labReport: the module reads it as a list of that report.
        labReport: labReport ? TENSILE_LAB_REPORT_ID : null,
      },
      weight: weightData(report.weight),
      watertight: watertightData(report),
      visual: visualData(report),
      dispensing_safedon: {
        sizes: bySize(report.dispensingSafedon.perSize, (entry) => ({
          boxes: entry.boxes.map((boxNo, index) => ({
            boxNo,
            counts: Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, entry.counts[code][index]])),
          })),
        })),
      },
      labeling: labelingData(report),
      conclusion: conclusionData(report),
    },
    custom: {},
  };
}

/** The SAFEDON_EG inspection's files: the tensile lab report, uploaded. */
export function safedonEgFiles(labReport = true): NonNullable<InspectionMeta["files"]> {
  return labReport ? [{ id: TENSILE_LAB_REPORT_ID, moduleKey: "tensile", kind: "lab_report" }] : [];
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export type Evaluated = {
  /** As evaluated: titles as the inspection shows them. */
  template: ResolvedTemplate;
  context: InspectionContext;
  report: ValidationReport;
  /** One included module's evaluation; throws when the inspection does not include it. */
  module(key: ModuleKey): ModuleEvaluation;
};

/** The inspection evaluated as the capture screen, submit, the review and the export do. */
export function evaluate(seeded: ResolvedTemplate, data: InspectionData, meta: InspectionMeta): Evaluated {
  const { template, context } = buildInspectionView({ template: seeded, data, meta }, MODULE_REGISTRY);
  const report = validateInspection(data, template, context, MODULE_REGISTRY);
  return {
    template,
    context,
    report,
    module(key) {
      const found = report.modules.find((entry) => entry.key === key);
      if (!found) throw new Error(`${template.code} does not include ${key}`);
      return found;
    },
  };
}

export function evaluateStdEg(options: StdEgOptions = {}): Evaluated {
  return evaluate(seedTemplate("STD_EG"), stdEgData(options), inspectionMeta(STD_EG_EXAMPLE));
}

export function evaluateSafedonEg(options: SafedonEgOptions = {}): Evaluated {
  const { labReport = true } = options;
  return evaluate(
    seedTemplate("SAFEDON_EG"),
    safedonEgData(options),
    inspectionMeta(SAFEDON_EG_EXAMPLE, safedonEgFiles(labReport)),
  );
}

/** A value inside a module's computed values, by path; undefined when it is not there. */
export function computedAt(evaluation: ModuleEvaluation, ...path: (string | number)[]): unknown {
  let value: unknown = evaluation.computed;
  for (const segment of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}
