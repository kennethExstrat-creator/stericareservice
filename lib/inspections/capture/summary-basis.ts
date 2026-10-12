// What a Steri-AI Summary draft was written from (docs/AI.md, "Steri-AI
// Summary"; 12 October 2026). Pure and client-safe: the server answers a
// draft with summaryBasisHash of the saved data, and the capture screen
// compares it with its own data's, to say "The inspection changed after
// Steri-AI wrote this summary." The summary itself is left out, so
// inserting or editing the draft never makes it stale.
import { contentHash, hashText } from "@/lib/offline/stable-json";
import type { InspectionData } from "@/modules/_framework";

/** The conclusion's key for the Inspection Summary (modules/conclusion/schema.ts). */
export const SUMMARY_DATA_KEY = "inspectionSummary";

/**
 * contentHash of the inspection's data without the conclusion's Inspection
 * Summary: 16 hex digits, the same whatever the key order, and the same
 * whether the summary is empty, missing or written.
 */
export function summaryBasisHash(data: InspectionData): string {
  const conclusion = data.modules.conclusion;
  if (typeof conclusion !== "object" || conclusion === null || Array.isArray(conclusion) || !(SUMMARY_DATA_KEY in conclusion)) {
    return contentHash(data);
  }
  const rest: Record<string, unknown> = { ...conclusion };
  delete rest[SUMMARY_DATA_KEY];
  return contentHash({ ...data, modules: { ...data.modules, conclusion: rest } });
}

/**
 * The hash a draft's "Drafted by Steri-AI" mark keeps: of its plain text
 * (richTextPlain), trimmed, so a change of formatting alone keeps the mark
 * and any change of wording drops it.
 */
export function summaryTextHash(text: string): string {
  return hashText(text.trim());
}
