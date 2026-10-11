// The suggested result from the results of every module the inspection
// includes (suggestResult: the rule behind inspections.suggested_result),
// beside the inspector's final result, which sets the status: pass, fail,
// and hold as warn, since a module status has no hold. Not done until the
// final result and the date are there; the conclusion is required for
// submit, so that blocks it, and the blocking issue links to what is
// missing. A final result that differs from the suggestion is a warning for
// the reviewer, never an error: the inspector decides. It points at the
// remark, where the reason goes, so its link lands there. Other modules are
// named by their titles in the template's wording (context.modules).
import type { InspectionResult, ModuleKey, ModuleResult, ModuleStatus } from "@/lib/schemas";
import {
  labelFor,
  moduleTitle,
  notDone,
  suggestionReasons,
  suggestResult,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
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
  const suggestion = suggest(results, context);
  const name = (key: ModuleKey) => moduleTitle(context, key);
  const computed: ConclusionComputed = {
    suggestedResult: suggestion.result,
    failed: suggestion.failed,
    notDone: suggestion.notDone,
    warned: suggestion.warned,
  };
  const suggested = `${labelFor(labels, "suggestedResult")}: ${resultWord(labels, suggestion.result)}${reasonOf(suggestion, true, name)}.`;
  const issues: CalcIssue[] = [];

  const final = data.finalResult;
  if (final !== null && final !== suggestion.result) {
    const explain = data.remark === null || data.remark.trim() === "" ? ` Explain why under ${labelFor(labels, "remark")}.` : "";
    issues.push(
      warningIssue(
        "final_result_differs",
        `${labelFor(labels, "finalResult")} ${resultWord(labels, final)} differs from the suggestion, ${resultWord(labels, suggestion.result)}${reasonOf(suggestion, false, name)}.${explain}`,
        { path: ["remark"] },
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
    return {
      result: notDone(`Missing: ${missing.join(", ")}. ${suggested}`),
      computed,
      issues,
      // The blocking issue opens the choice still to make: the result first, then the date.
      notDonePath: final === null ? ["finalResult"] : ["date"],
    };
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
 * One reason for the suggestion (suggestionReasons): `full` names every
 * section, as the submit confirmation and the review say it; `brief` is what
 * the Conclusion section shows on its one line: the same when the reason has
 * one section, else counted ("Not done: 9 sections."), `counted` true, with
 * `full` behind Show All.
 */
export type ConclusionReason = { full: string; brief: string; counted: boolean };

/**
 * Why the suggestion is what it is, for the Conclusion section: each of
 * suggestionReasons' lines, word for word, with a brief form that counts
 * the sections of a reason that has two or more. "No module has a result
 * yet." names none, so it is never counted; a clean pass has no reasons.
 */
export function conclusionReasons(
  suggested: Pick<SuggestedResult, "result" | "failed" | "notDone" | "warned">,
  titleOf: (key: ModuleKey) => string,
): ConclusionReason[] {
  // suggestionReasons: failed, then not done, then warnings (the non-empty ones), or "No module has a result yet."
  const groups = [suggested.failed, suggested.notDone, suggested.warned].filter((keys) => keys.length > 0);
  return suggestionReasons(suggested, titleOf).map((full, index) => {
    const count = groups[index]?.length ?? 0;
    return count < 2
      ? { full, brief: full, counted: false }
      : { full, brief: `${full.slice(0, full.indexOf(":"))}: ${count} sections.`, counted: true };
  });
}

/**
 * The modules that make the suggestion what it is, e.g. " (failed: Finished
 * Goods Sampling Information (carton number))". `withWarnings` adds the
 * warned modules to a pass. `name` gives a module's name: its title from the
 * context (moduleTitle); the key in words when left out.
 */
export function reasonOf(
  suggestion: SuggestedResult,
  withWarnings: boolean,
  name: (key: ModuleKey) => string = moduleName,
): string {
  const names = (keys: readonly ModuleKey[]) => keys.map(name).join(", ");
  if (suggestion.failed.length > 0) return ` (failed: ${names(suggestion.failed)})`;
  if (suggestion.notDone.length > 0) return ` (not done: ${names(suggestion.notDone)})`;
  if (suggestion.result === "hold") return " (no module has a result yet)";
  if (withWarnings && suggestion.warned.length > 0) return ` (warnings: ${names(suggestion.warned)})`;
  return "";
}

/**
 * A module's key in words, "Carton sampling": the name of a module the
 * context does not list.
 *
 * @deprecated Name modules by their title: `moduleTitle(context, key)` from
 * `@/modules/_framework`, which falls back to these words.
 */
export function moduleName(key: ModuleKey): string {
  return moduleTitle({ modules: [] }, key);
}

function suggest(
  results: Readonly<Partial<Record<ModuleKey, ModuleResult>>>,
  context: Pick<InspectionContext, "modules">,
): SuggestedResult {
  const inputs: SuggestionInput[] = [];
  for (const [key, result] of Object.entries(results) as [ModuleKey, ModuleResult | undefined][]) {
    if (result) inputs.push({ key, status: result.status, title: moduleTitle(context, key) });
  }
  return suggestResult(inputs);
}
