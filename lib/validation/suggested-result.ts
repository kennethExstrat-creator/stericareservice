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
//
// Why the suggestion is what it is, in words: suggestionReasons below. The
// result itself is a pill in docs/DESIGN.md's words (Passed, Failed, On hold),
// so no reason starts with a result word and a clean pass has none.
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
  /**
   * The reasons on one line, the sections by their titles, e.g. "Failed:
   * Freedom from Holes by watertight test. Warnings: Weight (g)."; empty for
   * a clean pass. Never a result word: show the result beside it.
   */
  summary: string;
};

const VERDICTS: ReadonlySet<ModuleStatus> = new Set(["pass", "warn", "fail"]);

export function suggestResult(modules: readonly SuggestionInput[]): SuggestedResult {
  const considered = modules.filter((module) => module.key !== "conclusion");
  const keysWith = (status: ModuleStatus) =>
    considered.filter((module) => module.status === status).map((module) => module.key);
  const failed = keysWith("fail");
  const notDone = keysWith("not_done");
  const warned = keysWith("warn");

  let result: InspectionResult;
  if (failed.length > 0) result = "fail";
  else if (notDone.length > 0) result = "hold";
  else if (!considered.some((module) => VERDICTS.has(module.status))) result = "hold";
  else result = "pass";

  const titles = new Map<string, string>(considered.map((module) => [module.key, module.title ?? module.key]));
  const suggestion = { result, failed, notDone, warned };
  return { ...suggestion, summary: suggestionReasons(suggestion, (key) => titles.get(key) ?? key).join(" ") };
}

/**
 * Why the suggestion is what it is, a line per reason: "Failed: …", "Not
 * done: …", "Warnings: …", each naming the sections by `titleOf` (their
 * titles in the template's wording), or "No module has a result yet." when
 * nothing was tested. None for a clean pass: the result beside them says it.
 * The Conclusion section, the submit confirmation, the review and the summary
 * above all say it this way.
 */
export function suggestionReasons(
  suggested: Pick<SuggestedResult, "result" | "failed" | "notDone" | "warned">,
  titleOf: (key: ModuleKey) => string,
): string[] {
  const names = (keys: readonly ModuleKey[]) => keys.map(titleOf).join(", ");
  const reasons: string[] = [];
  if (suggested.failed.length > 0) reasons.push(`Failed: ${names(suggested.failed)}.`);
  if (suggested.notDone.length > 0) reasons.push(`Not done: ${names(suggested.notDone)}.`);
  if (suggested.warned.length > 0) reasons.push(`Warnings: ${names(suggested.warned)}.`);
  // On hold with nothing failed or missing: nothing was tested.
  if (reasons.length === 0 && suggested.result === "hold") reasons.push("No module has a result yet.");
  return reasons;
}
