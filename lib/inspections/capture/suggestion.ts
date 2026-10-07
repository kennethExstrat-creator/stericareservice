// What the submit confirmation says under the suggested result (BUILD_SPEC
// 6.1 conclusion): the pill names the result in DESIGN.md's words (Passed,
// Failed, On Hold, as every result pill does), and these lines say why,
// worded as the Conclusion section words them one screen before: "Failed:
// …", "Not done: …", "Warnings: …", each with the sections in the template's
// wording. A clean pass has nothing to add, so nothing repeats the pill. The
// words are the suggestion's own (lib/validation/suggested-result.ts), so the
// review and the suggestion's summary say the same.
export { suggestionReasons } from "@/lib/validation/suggested-result";
