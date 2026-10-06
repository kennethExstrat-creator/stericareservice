import { InspectionResultSchema, type InspectionResult } from "@/lib/schemas/common";

/** The inspector's final result and remark. */
export type InspectorDecision = { result: InspectionResult | null; remarks: string | null };

/**
 * The inspector's final result and remark: what they entered in the
 * conclusion module (`finalResult` and `remark`, its data as the evaluation
 * parsed it), with the inspection row's copies standing in where the module
 * holds none. `inspections.result` and `inspections.remarks` only mirror the
 * conclusion for lists and search (the capture screen copies them on every
 * save), so they speak only for data saved before the module was built, data
 * that no longer reads, or a final result chosen without its date yet.
 *
 * The review, its AI panel and the export (with the AI hand-offs fed from
 * it) all take them this way, so they never disagree. A remark is trimmed;
 * a blank one is none.
 */
export function inspectorDecision(row: InspectorDecision, conclusionData: unknown): InspectorDecision {
  const saved = isRecord(conclusionData) ? conclusionData : {};
  const result = InspectionResultSchema.safeParse(saved.finalResult);
  return {
    result: result.success ? result.data : (row.result ?? null),
    remarks: textOrNull(saved.remark) ?? textOrNull(row.remarks),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
