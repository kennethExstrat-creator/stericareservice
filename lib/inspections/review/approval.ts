// What the approve dialog weighs (BUILD_SPEC 5): the inspector's final
// result, the app's suggestion and what the checks found, and the cautions
// they call for. None of them blocks approval: Kenneth has not said whether
// they should, so the dialog warns and the admin decides.
import type { InspectionResult } from "@/lib/schemas/common";
import type { ReviewEvaluation } from "./evaluate";
import { plural } from "./format";

export type ApprovalFacts = {
  finalResult: InspectionResult | null;
  /** The app's suggestion; null when the results could not be worked out. */
  suggestedResult: InspectionResult | null;
  /** Errors the checks found; null when the results could not be worked out, so nothing was checked. */
  errors: number | null;
};

/** The suggestion and the error count, or null for both when nothing could be checked: never 0 errors then. */
export function approvalChecks(evaluation: ReviewEvaluation): Pick<ApprovalFacts, "suggestedResult" | "errors"> {
  return evaluation.ok
    ? { suggestedResult: evaluation.report.suggested.result, errors: evaluation.summary.errors }
    : { suggestedResult: null, errors: null };
}

/** What should make the admin stop before approving, the gravest first. */
export function approvalCautions({ finalResult, suggestedResult, errors }: ApprovalFacts): string[] {
  const cautions: string[] = [];
  if (errors === null) {
    cautions.push("The results could not be worked out, so nothing was checked. Ask a developer before you approve it.");
  }
  if (finalResult === null) cautions.push("The inspector has not chosen a final result.");
  if (finalResult !== null && suggestedResult !== null && finalResult !== suggestedResult) {
    cautions.push("The final result differs from the suggested result.");
  }
  if (errors !== null && errors > 0) {
    cautions.push(
      `The checks found ${plural(errors, "error")}. Reopen it instead if the inspector should fix ${errors === 1 ? "it" : "them"} first.`,
    );
  }
  return cautions;
}
