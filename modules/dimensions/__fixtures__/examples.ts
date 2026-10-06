// The example reports (tests/fixtures/examples) in this module's shapes: the
// dimension tables as data, the ordered sizes and the sampling plan's n as a
// context, and each seed template's config and wording (lib/coverage).
import { labelOverrides, moduleConfig, type TemplateCode } from "@/lib/coverage";
import type { InspectionContext } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import {
  intendedValue,
  type DimensionMeasure,
  type DimensionSection,
  type ExampleReport,
  type NumberCell,
} from "@/tests/fixtures/examples";
import { DIMENSIONS_LABELS, DimensionsConfigSchema, type DimensionsConfig, type Measure } from "../config";
import { emptyGlove, type DimensionsData } from "../schema";

/** The fixtures' short column names, as the module's measure keys. */
export const FIXTURE_MEASURE: Readonly<Record<DimensionMeasure, Measure>> = {
  length: "length",
  width: "width",
  finger: "fingerThickness",
  palm: "palmThickness",
  cuff: "cuffThickness",
};

/**
 * The report's dimension tables as module data. `read` turns a cell into what
 * is stored: the corrected number by default; `spreadsheetValue` reads a text
 * cell as missing, as the original report's AVERAGE did.
 */
export function dimensionsData(
  section: DimensionSection,
  read: (cell: NumberCell) => number | null = intendedValue,
): DimensionsData {
  const sizes = Object.entries(section.perSize).map(([size, table]) => [
    size,
    {
      gloves: table.gloves.map((row) => ({
        ...emptyGlove(),
        ...Object.fromEntries(section.columns.map((column, index) => [FIXTURE_MEASURE[column], read(row[index])])),
      })),
    },
  ]);
  return { sizes: Object.fromEntries(sizes) };
}

/** The example's ordered sizes and its sampling plan's gloves for dimension. */
export function exampleContext(example: ExampleReport, overrides: Partial<InspectionContext> = {}): InspectionContext {
  const sampling = Object.entries(example.sampling).map(([size, row]) => [
    size,
    makeSampling({ cases: row.cases, gloves: row.gloves, dimensions: row.dimensionGloves }),
  ]);
  return makeTestContext({ sizes: [...example.sizesOrdered], sampling: Object.fromEntries(sampling), ...overrides });
}

/** The seed template's dimensions config, as the module parses it. */
export function templateConfig(code: TemplateCode): DimensionsConfig {
  return DimensionsConfigSchema.parse(moduleConfig(code, "dimensions"));
}

/** The seed template's wording over the module's defaults (effectiveLabels). */
export function templateLabels(code: TemplateCode): Record<string, string> {
  return { ...DIMENSIONS_LABELS, ...labelOverrides(code, "dimensions") };
}
