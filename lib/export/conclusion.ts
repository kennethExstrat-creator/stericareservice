import { InspectionResultSchema, type InspectionResult, type JsonValue } from "@/lib/schemas/common";
import { RichTextDocSchema, type RichTextDoc } from "@/lib/schemas/rich-text";

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

/**
 * The inspector's inspection summary (`conclusion.inspectionSummary`, the
 * conclusion's data as the evaluation parsed it), or null when there is
 * none or it does not read. The review and the export take it this way.
 */
export function inspectionSummaryOf(conclusionData: unknown): RichTextDoc | null {
  const saved = isRecord(conclusionData) ? conclusionData.inspectionSummary : null;
  const parsed = RichTextDocSchema.safeParse(saved);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether the report is to be signed by hand after it is exported
 * (`conclusion.signAfterExport`, To Sign After Exported; Kenneth, 13 October
 * 2026): true only when the conclusion's data says so, so data saved before
 * the switch existed reads as false.
 */
export function signAfterExportOf(conclusionData: unknown): boolean {
  return isRecord(conclusionData) && conclusionData.signAfterExport === true;
}

/**
 * The conclusion's data as the export sends it: while the report is to be
 * signed by hand after export, without a drawn signature (`signature`
 * null), so the report leaves its signature line blank for the pen. The
 * strokes stay in the inspection's data, for when the switch goes off.
 */
export function conclusionDataForExport(conclusionData: Record<string, JsonValue>): Record<string, JsonValue> {
  if (!signAfterExportOf(conclusionData) || conclusionData.signature === null) return conclusionData;
  return { ...conclusionData, signature: null };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
