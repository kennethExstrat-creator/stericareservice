// The suggested result from the results of every module the inspection
// includes (suggestResult: the rule behind inspections.suggested_result),
// beside the inspector's final result, which sets the status: pass, fail,
// and hold as warn, since a module status has no hold. Not done until the
// final result and the date are there; the conclusion is required for
// submit, so that blocks it. A final result that differs from the suggestion
// is a warning for the reviewer, never an error: the inspector decides.
import type { InspectionResult, ModuleKey, ModuleResult, ModuleStatus } from "@/lib/schemas";
import {
  labelFor,
  notDone,
  suggestResult,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type Labels,
  type SuggestedResult,
  type SuggestionInput,
} from "@/modules/_framework";
import type { ConclusionConfig } from "./config";
import type { ConclusionData } from "./schema";

export type ConclusionComputed = {
  /** `inspections.suggested_result`. */
  suggestedResult: InspectionResult;
  /** Modules behind the suggestion, in template order. */
  failed: ModuleKey[];
  notDone: ModuleKey[];
  warned: ModuleKey[];
};

const STATUS_OF_RESULT: Readonly<Record<InspectionResult, ModuleStatus>> = {
  pass: "pass",
  fail: "fail",
  hold: "warn",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function calcConclusion({
  data,
  labels,
  context,
  results,
}: CalcInput<ConclusionData, ConclusionConfig>): CalcOutput<ConclusionComputed> {
  const suggestion = suggest(results);
  const computed: ConclusionComputed = {
    suggestedResult: suggestion.result,
    failed: suggestion.failed,
    notDone: suggestion.notDone,
    warned: suggestion.warned,
  };
  const suggested = `${labelFor(labels, "suggestedResult")}: ${resultWord(labels, suggestion.result)}${reasonOf(suggestion, true)}.`;
  const issues: CalcIssue[] = [];

  const final = data.finalResult;
  if (final !== null && final !== suggestion.result) {
    const explain = data.remark === null || data.remark.trim() === "" ? ` Explain why under ${labelFor(labels, "remark")}.` : "";
    issues.push(
      warningIssue(
        "final_result_differs",
        `${labelFor(labels, "finalResult")} ${resultWord(labels, final)} differs from the suggestion, ${resultWord(labels, suggestion.result)}${reasonOf(suggestion, false)}.${explain}`,
        { path: ["finalResult"] },
      ),
    );
  }

  const inspectionDate = context.header.inspectionDate;
  if (data.date !== null && inspectionDate !== null && ISO_DATE.test(inspectionDate) && data.date < inspectionDate) {
    issues.push(
      warningIssue(
        "date_before_inspection",
        `${labelFor(labels, "date")} ${data.date} is before the inspection date, ${inspectionDate}.`,
        { path: ["date"] },
      ),
    );
  }

  const missing = [
    ...(final === null ? [labelFor(labels, "finalResult")] : []),
    ...(data.date === null ? [labelFor(labels, "date")] : []),
  ];
  if (final === null || missing.length > 0) {
    return { result: notDone(`Missing: ${missing.join(", ")}. ${suggested}`), computed, issues };
  }

  const signed = data.signature === null ? " Not signed." : "";
  return {
    result: {
      status: STATUS_OF_RESULT[final],
      summary: `${labelFor(labels, "finalResult")}: ${resultWord(labels, final)}. ${suggested}${signed}`,
    },
    computed,
    issues,
  };
}

/** The template's word for a result: PASSED, FAILED, HOLD. */
export function resultWord(labels: Labels, result: InspectionResult): string {
  return labelFor(labels, result);
}

/**
 * The modules that make the suggestion what it is, e.g. " (failed: Carton
 * sampling)". `withWarnings` adds the warned modules to a pass.
 */
export function reasonOf(suggestion: SuggestedResult, withWarnings: boolean): string {
  const names = (keys: readonly ModuleKey[]) => keys.map(moduleName).join(", ");
  if (suggestion.failed.length > 0) return ` (failed: ${names(suggestion.failed)})`;
  if (suggestion.notDone.length > 0) return ` (not done: ${names(suggestion.notDone)})`;
  if (suggestion.result === "hold") return " (no module has a result yet)";
  if (withWarnings && suggestion.warned.length > 0) return ` (warnings: ${names(suggestion.warned)})`;
  return "";
}

/**
 * A module's name for the suggestion. calc receives the other modules'
 * results but not their titles, so the key stands in, in words: "Carton
 * sampling". The engine's own suggestion (InspectionEvaluation.suggested)
 * names them by title.
 */
export function moduleName(key: ModuleKey): string {
  const words = key.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function suggest(results: Readonly<Partial<Record<ModuleKey, ModuleResult>>>): SuggestedResult {
  const inputs: SuggestionInput[] = [];
  for (const [key, result] of Object.entries(results) as [ModuleKey, ModuleResult | undefined][]) {
    if (result) inputs.push({ key, status: result.status, title: moduleName(key) });
  }
  return suggestResult(inputs);
}
