// Defaults a template can override: the heading and the labels (both
// reports' wording). The conclusion has no config (BUILD_SPEC 6.1).
import { z } from "zod";

export const CONCLUSION_TITLE = "Conclusion";

/**
 * Data field keys and captions (docs/DATA_DICTIONARY.md, conclusion). The
 * words for each result are the template's: the reports print PASSED or
 * FAILED; the app adds HOLD.
 */
export const CONCLUSION_LABELS = {
  suggestedResult: "Suggested Result",
  finalResult: "Conclusion",
  remark: "Remark",
  inspectionSummary: "Inspection Summary",
  inspector: "Inspected By",
  date: "Date",
  signature: "Signature",
  pass: "PASSED",
  fail: "FAILED",
  hold: "HOLD",
} as const satisfies Readonly<Record<string, string>>;

export const ConclusionConfigSchema = z.strictObject({}).describe("The conclusion has no settings.");
export type ConclusionConfig = z.infer<typeof ConclusionConfigSchema>;

export const CONCLUSION_DEFAULT_CONFIG: ConclusionConfig = {};
