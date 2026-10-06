// The suggested overall result (BUILD_SPEC 6.1 conclusion, 4.2 rule 7). One
// rule, applied to the results of the modules included in the inspection:
//
//   1. fail  if any module failed;
//   2. hold  if any module is not done (missing data is never a pass, 6.2.5);
//   3. hold  if no module gave a verdict (nothing was tested);
//   4. pass  otherwise. Warnings do not change the suggestion: they are listed
//            with it and go into the export.
//
// The conclusion's own result is the inspector's final decision, so it is
// left out. The suggestion never changes the final result; the inspector
// (and later an admin) decides.
import type { InspectionResult } from "@/lib/schemas/common";
import type { ModuleKey, ModuleStatus } from "@/lib/schemas/module-result";

export type SuggestionInput = {
  key: ModuleKey;
  status: ModuleStatus;
  /** Heading in the template's wording, for the summary; the key when absent. */
  title?: string;
};

export type SuggestedResult = {
  result: InspectionResult;
  failed: ModuleKey[];
  notDone: ModuleKey[];
  warned: ModuleKey[];
  /** One line for the conclusion, e.g. "Fail: Freedom from Holes by watertight test." */
  summary: string;
};

const VERDICTS: ReadonlySet<ModuleStatus> = new Set(["pass", "warn", "fail"]);

export function suggestResult(modules: readonly SuggestionInput[]): SuggestedResult {
  const considered = modules.filter((module) => module.key !== "conclusion");
  const keysWith = (status: ModuleStatus) => considered.filter((module) => module.status === status);
  const failed = keysWith("fail");
  const notDone = keysWith("not_done");
  const warned = keysWith("warn");
  const names = (list: readonly SuggestionInput[]) => list.map((module) => module.title ?? module.key).join(", ");
  const warnings = warned.length > 0 ? ` Warnings: ${names(warned)}.` : "";

  let result: InspectionResult;
  let summary: string;
  if (failed.length > 0) {
    result = "fail";
    summary = `Fail: ${names(failed)}.`;
  } else if (notDone.length > 0) {
    result = "hold";
    summary = `Hold: not done: ${names(notDone)}.`;
  } else if (!considered.some((module) => VERDICTS.has(module.status))) {
    result = "hold";
    summary = "Hold: no module has a result yet.";
  } else {
    result = "pass";
    summary = "Pass.";
  }

  return {
    result,
    failed: failed.map((module) => module.key),
    notDone: notDone.map((module) => module.key),
    warned: warned.map((module) => module.key),
    summary: `${summary}${warnings}`,
  };
}
