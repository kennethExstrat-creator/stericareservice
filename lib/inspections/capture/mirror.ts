// The `inspections` columns that repeat values from the data, so the list can
// search and show them without reading every inspection's JSON (BUILD_SPEC 5,
// 6.2 rule 10). Written in the same update as the data on every save and on
// submit, so they always match it:
//
// - po_no, product_name: the header's PO and product (blank clears them);
// - lot_numbers: every ordered size's lot numbers from order_lots;
// - inspection_date: the header's inspection date, when it holds one (the
//   column cannot be empty, so a blank header date leaves it as it is);
// - suggested_result: the framework's suggestion over the included modules;
// - result: the inspector's final result from the conclusion, whose status
//   is pass for pass, fail for fail and warn for hold (docs/MODULES.md 14);
//   empty until the conclusion is done;
// - remarks: the conclusion's remark (docs/DATA_DICTIONARY.md, conclusion
//   `remark`), blank as empty.
//
// client_id and manufacturer_id are chosen when the inspection is created and
// never change here.
import type { MirroredColumns } from "@/lib/offline/supabase-transport";
import { IsoDateSchema, type InspectionResult } from "@/lib/schemas/common";
import type { ModuleStatus } from "@/lib/schemas/module-result";
import { inspectionRowValues, type InspectionEvaluation } from "@/modules/_framework";
import type { CaptureEvaluation } from "./evaluate";

const FINAL_RESULT: Partial<Record<ModuleStatus, InspectionResult>> = {
  pass: "pass",
  fail: "fail",
  warn: "hold",
};

/** The final result the conclusion records, or null while it is not done (or not built). */
export function finalResultOf(evaluation: Pick<InspectionEvaluation, "modules">): InspectionResult | null {
  const conclusion = evaluation.modules.find((entry) => entry.key === "conclusion");
  if (!conclusion || conclusion.stub) return null;
  return FINAL_RESULT[conclusion.result.status] ?? null;
}

/** The conclusion's remark as typed, trimmed; null when blank, unreadable or switched off. */
export function remarksOf(evaluation: Pick<InspectionEvaluation, "modules">): string | null {
  const conclusion = evaluation.modules.find((entry) => entry.key === "conclusion");
  const data = conclusion?.data;
  if (typeof data !== "object" || data === null || !("remark" in data)) return null;
  const { remark } = data;
  return typeof remark === "string" && remark.trim() !== "" ? remark.trim() : null;
}

export function mirroredColumns({ context, report }: Pick<CaptureEvaluation, "context" | "report">): MirroredColumns {
  const columns: MirroredColumns = {
    ...inspectionRowValues(context),
    suggested_result: report.suggested.result,
    result: finalResultOf(report),
    remarks: remarksOf(report),
  };
  const date = context.header.inspectionDate;
  if (date !== null && IsoDateSchema.safeParse(date).success) columns.inspection_date = date;
  return columns;
}
