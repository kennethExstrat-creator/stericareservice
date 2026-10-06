// Small accessors for the example-report fixtures (docs/FIXTURES.md).
import type { ModuleKey } from "@/lib/schemas";
import type {
  CartonGrid,
  DimensionMeasure,
  DimensionSection,
  DispensingSafedonEntry,
  NumberCell,
  ReportSize,
  SafedonDefectCode,
  TextCell,
} from "./types";

/** A numeric cell the inspector typed as text. */
export function textCell(raw: string, intended: number, note: string): TextCell {
  return { kind: "text", raw, intended, note };
}

export function isTextCell(cell: NumberCell): cell is TextCell {
  return typeof cell !== "number";
}

/** The value the app stores once the cell is corrected. */
export function intendedValue(cell: NumberCell): number {
  return isTextCell(cell) ? cell.intended : cell;
}

/**
 * What a spreadsheet reads from the cell: a number, or null for text, which
 * AVERAGE and MEDIAN skip. This is how the original report computed.
 */
export function spreadsheetValue(cell: NumberCell): number | null {
  return isTextCell(cell) ? null : cell;
}

/** One measure's cells for a size, glove 1 first. */
export function dimensionColumn(
  section: DimensionSection,
  size: ReportSize,
  measure: DimensionMeasure,
): readonly NumberCell[] {
  const table = section.perSize[size];
  const index = section.columns.indexOf(measure);
  if (!table || index === -1) throw new Error(`No ${measure} column for size ${size}.`);
  return table.gloves.map((row) => row[index]);
}

/** Carton numbers in reading order (row by row), duplicates kept. */
export function cartonList(grid: CartonGrid): number[] {
  return grid.rows.flat();
}

/** The six Safedon dispensing defects, in print order. */
export const SAFEDON_DEFECTS = [
  "no_cuff",
  "finger_out",
  "multiple_out",
  "stuck",
  "sticky",
  "faulty_cuff",
] as const satisfies readonly SafedonDefectCode[];

/** Defects per box, all six rows added, in box order. */
export function safedonDefectsPerBox(entry: DispensingSafedonEntry): number[] {
  return entry.boxes.map((_, box) => SAFEDON_DEFECTS.reduce((sum, code) => sum + entry.counts[code][box], 0));
}

/** The module each report section feeds (BUILD_SPEC 6.1). */
export const SECTION_MODULE = {
  header: "header",
  gloveInfo: "glove_info",
  order: "order_lots",
  packing: "packing_config",
  sampling: "sampling_plan",
  cartons: "carton_sampling",
  dimensions: "dimensions",
  weight: "weight",
  forceAtBreak: "force_at_break",
  tensile: "tensile",
  watertight: "watertight",
  visual: "visual",
  dispensingPacking: "dispensing_packing",
  dispensingSafedon: "dispensing_safedon",
  labeling: "labeling",
  conclusion: "conclusion",
} as const satisfies Record<string, ModuleKey>;

/** Freezes a fixture all the way down, so no test can change it for another. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
