// What a Steri-AI Summary draft was written from (docs/AI.md, "Steri-AI
// Summary"; 12 October 2026). Pure and client-safe: the server answers a
// draft with summaryBasisHash of the saved data, and the capture screen
// compares it with its own data's, to say "The inspection changed after
// Steri-AI wrote this summary." The summary itself is left out, so
// inserting or editing the draft never makes it stale. To Sign After
// Exported off counts as missing (Kenneth, 13 October 2026): inserting the
// draft writes a conclusion saved before the switch existed back with it.
// The Report page's options are left out too (27 October 2026): how the
// report is laid out is nothing the summary is written from.
import { contentHash, hashText } from "@/lib/offline/stable-json";
import type { InspectionData } from "@/modules/_framework";

/** The conclusion's key for the Inspection Summary (modules/conclusion/schema.ts). */
export const SUMMARY_DATA_KEY = "inspectionSummary";

/** The conclusion's key for To Sign After Exported (modules/conclusion/schema.ts), false by default. */
export const SIGN_AFTER_EXPORT_KEY = "signAfterExport";

/**
 * contentHash of the inspection's data without the conclusion's Inspection
 * Summary and the Report page's options: 16 hex digits, the same whatever
 * the key order, and the same whether the summary is empty, missing or
 * written, whether To Sign After Exported is off or missing, and whatever
 * the report options are.
 */
export function summaryBasisHash(data: InspectionData): string {
  const basis: InspectionData = { ...data };
  delete basis.report;
  const conclusion = basis.modules.conclusion;
  if (
    typeof conclusion !== "object" ||
    conclusion === null ||
    Array.isArray(conclusion) ||
    !(SUMMARY_DATA_KEY in conclusion || SIGN_AFTER_EXPORT_KEY in conclusion)
  ) {
    return contentHash(basis);
  }
  const rest: Record<string, unknown> = { ...conclusion };
  delete rest[SUMMARY_DATA_KEY];
  if (rest[SIGN_AFTER_EXPORT_KEY] !== true) delete rest[SIGN_AFTER_EXPORT_KEY];
  return contentHash({ ...basis, modules: { ...basis.modules, conclusion: rest } });
}

/**
 * The hash a draft's "Drafted by Steri-AI" mark keeps: of its plain text
 * (richTextPlain), trimmed, so a change of formatting alone keeps the mark
 * and any change of wording drops it.
 */
export function summaryTextHash(text: string): string {
  return hashText(text.trim());
}
