// What the submit confirmation says under the suggested result (BUILD_SPEC
// 6.1 conclusion): the pill names the result in DESIGN.md's words (Passed,
// Failed, On hold, as every pill outside the Conclusion section does), and
// these lines say why, worded as the Conclusion section words them one
// screen before: "Failed: …", "Not done: …", "Warnings: …", each with the
// sections in the template's wording. A clean pass has nothing to add, so
// nothing repeats the pill.
import type { SuggestedResult } from "@/lib/validation";

export function suggestionReasons(
  suggested: Pick<SuggestedResult, "result" | "failed" | "notDone" | "warned">,
  titleOf: (key: string) => string,
): string[] {
  const names = (keys: readonly string[]) => keys.map(titleOf).join(", ");
  const reasons: string[] = [];
  if (suggested.failed.length > 0) reasons.push(`Failed: ${names(suggested.failed)}.`);
  if (suggested.notDone.length > 0) reasons.push(`Not done: ${names(suggested.notDone)}.`);
  if (suggested.warned.length > 0) reasons.push(`Warnings: ${names(suggested.warned)}.`);
  // On hold with nothing failed or missing: nothing was tested.
  if (reasons.length === 0 && suggested.result === "hold") reasons.push("No module has a result yet.");
  return reasons;
}
