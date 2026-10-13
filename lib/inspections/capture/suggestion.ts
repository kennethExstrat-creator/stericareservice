// What the submit confirmation says under the suggested result (BUILD_SPEC
// 6.1 conclusion): the pill names the result in DESIGN.md's words (Passed,
// Failed, On Hold, as every result pill does), and these lines say why,
// worded as the Conclusion section words them one screen before: "Failed:
// …", "Not done: …", "Warnings: …", each with the sections by their short
// names, as the sidebar and Pending name them ("Failed: Carton Numbers.
// Warnings: Weight."; docs/DESIGN.md, Step Names). A clean pass has nothing
// to add, so nothing repeats the pill. The words are the suggestion's own
// (lib/validation/suggested-result.ts): the review and the suggestion's
// summary say the same with the sections in the template's wording.
import { MODULE_SHORT_TITLES } from "@/lib/templates/short-titles";
import { suggestionReasons, type SuggestedResult } from "@/lib/validation/suggested-result";
import type { CaptureSection } from "./sections";

export { suggestionReasons };

/**
 * The submit confirmation's lines: suggestionReasons with each section by
 * its short name (`shortTitle`, lib/templates/short-titles.ts); a module
 * the screen does not list by its module's short name.
 */
export function submitReasons(
  suggested: Pick<SuggestedResult, "result" | "failed" | "notDone" | "warned">,
  sections: readonly Pick<CaptureSection, "key" | "shortTitle">[],
): string[] {
  return suggestionReasons(
    suggested,
    (key) => sections.find((section) => section.key === key)?.shortTitle ?? MODULE_SHORT_TITLES[key],
  );
}
