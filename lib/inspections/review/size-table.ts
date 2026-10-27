// The review's table for one module (layout A, Kenneth, 27 October 2026):
// the module's measures down the side, the ordered sizes across, so sizes
// read side by side instead of as a sentence each. Built from what the
// module's calc computed (`entry.computed`, its config and its labels),
// never typed: each module that has per-size figures has an adapter in
// ./size-tables. A module without one (the header, glove information,
// packing configuration, the conclusion, documents, loading) has no table;
// the review shows its result's summary instead.
//
// The columns are `context.sizes`, the ordered sizes in the template's
// order; every row has one cell per size, in that order. The review adds
// the column headings and a Result row of its own from `entry.result.perSize`.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { cartonSamplingTable } from "./size-tables/carton-sampling";
import { dimensionsTable } from "./size-tables/dimensions";
import { dispensingPackingTable } from "./size-tables/dispensing-packing";
import { dispensingSafedonTable } from "./size-tables/dispensing-safedon";
import { dyeLeakTable } from "./size-tables/dye-leak";
import { forceAtBreakTable } from "./size-tables/force-at-break";
import { labelingTable } from "./size-tables/labeling";
import { orderLotsTable } from "./size-tables/order-lots";
import { samplingPlanTable } from "./size-tables/sampling-plan";
import { tensileTable } from "./size-tables/tensile";
import { visualTable } from "./size-tables/visual";
import { watertightTable } from "./size-tables/watertight";
import { weightTable } from "./size-tables/weight";

/**
 * Marks a cell to look at: `warn` (amber) for something the inspector or an
 * admin should check, such as a defect label the template does not list;
 * `fail` (red) for a value outside its spec or a count past its limit.
 */
export type SizeTableTone = "warn" | "fail";

export type SizeTableCell = {
  /** The value as the module's summary prints it ("243", "5 / 315", "90.4%"); null shows "—". */
  text: string | null;
  /** A second, smaller line: a spec or limit that differs by size ("80 ± 10", "Limit 10 / 11"), a breakdown. */
  note?: string;
  tone?: SizeTableTone;
};

export type SizeTableRow = {
  /** Stable within the table: the measure's or class's code. */
  key: string;
  /** In the template's wording: "Length (mm)", "Major Defects", "Aged Sample: Layering". */
  label: string;
  /** A spec or limit every size shares, shown under the label: "≥ 240", "Min. 70%", "Limit 0 / 1". */
  spec?: string;
  /** One per ordered size, in `context.sizes` order. */
  cells: SizeTableCell[];
};

export type SizeTable = {
  rows: SizeTableRow[];
  /** What every value is, over the labels in the table's corner: "Median", the template's "Average". */
  corner?: string;
};

/** Builds a module's table; null when it has nothing to show (no data yet, nothing per size). */
export type SizeTableAdapter = (entry: ModuleEvaluation, context: InspectionContext) => SizeTable | null;

const ADAPTERS: Partial<Record<ModuleKey, SizeTableAdapter>> = {
  order_lots: orderLotsTable,
  sampling_plan: samplingPlanTable,
  carton_sampling: cartonSamplingTable,
  dimensions: dimensionsTable,
  weight: weightTable,
  force_at_break: forceAtBreakTable,
  tensile: tensileTable,
  dye_leak: dyeLeakTable,
  watertight: watertightTable,
  visual: visualTable,
  dispensing_packing: dispensingPackingTable,
  dispensing_safedon: dispensingSafedonTable,
  labeling: labelingTable,
};

/**
 * The module's table, or null. A stub module, one with nothing ordered yet,
 * or computed values an adapter cannot read show no table: the review falls
 * back to the result's summary, never to a broken page.
 */
export function sizeTable(entry: ModuleEvaluation, context: InspectionContext): SizeTable | null {
  if (entry.stub || context.sizes.length === 0) return null;
  const adapter = ADAPTERS[entry.key];
  if (!adapter) return null;
  try {
    const table = adapter(entry, context);
    if (!table || table.rows.length === 0) return null;
    // Every row one cell per size: a short row is padded, a long one cut.
    const width = context.sizes.length;
    return {
      ...(table.corner ? { corner: table.corner } : {}),
      rows: table.rows.map((row) => ({
        ...row,
        cells: Array.from({ length: width }, (_, index) => row.cells[index] ?? { text: null }),
      })),
    };
  } catch (error) {
    console.error(`Inspection review: the ${entry.key} table could not be built`, error);
    return null;
  }
}

// The adapters' cell helpers live apart, so no adapter imports this file at runtime (./size-tables/cells.ts).
export { cellsBySize, EMPTY_CELL } from "./size-tables/cells";
