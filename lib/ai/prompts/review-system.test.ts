import { describe, expect, it } from "vitest";
import { MEDIA_CATEGORIES, SOURCE_DOCUMENTS_KEY, SOURCE_MEDIA_KEY } from "@/lib/inspections/source-documents";
import { REVIEW_SYSTEM_PROMPT } from "./review-system";

describe("the review's system prompt", () => {
  it("tells the reviewer Source Documents' keys are no modules: a finding citing one is refused", () => {
    // findUnknownReferences (lib/schemas/ai-review.ts) refuses a review that names a module the export does not have.
    const photos = REVIEW_SYSTEM_PROMPT.split("\n").find((line) => line.startsWith("- photos and files:")) ?? "";
    for (const { key, title } of MEDIA_CATEGORIES) expect(photos).toContain(`${key} (${title})`);
    expect(photos).toContain(SOURCE_DOCUMENTS_KEY);
    expect(photos).toContain(SOURCE_MEDIA_KEY);
    expect(photos).toContain("never give one as a finding's or a question's module");
  });

  it("reads box/carton numbers as the size's sampled carton numbers, an unlisted one a warning (Kenneth, 13 October 2026)", () => {
    const line = (key: string) => REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith(`- ${key}:`)) ?? "";
    for (const key of ["dispensing_packing", "dispensing_safedon", "labeling"]) {
      expect(line(key), key).toContain("box/carton number");
      expect(line(key), key).toContain("the size's sampled box/carton numbers");
      expect(line(key), key).toContain("one the size's list does not hold is a warning box_not_in_carton_list");
    }
    expect(line("carton_sampling")).toContain("the sampled box/carton numbers");
    const check = REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith("- Box/carton numbers:")) ?? "";
    // Still checked in carton_sampling; in dispensing and labelling an unlisted one is a warning, never an error.
    expect(check).toContain("in carton_sampling, duplicates within a size, numbers outside 1 to the order quantity");
    expect(check).toContain("one the size's list does not hold is the app's warning (box_not_in_carton_list), never an error");
    expect(check).toContain("The same number in several dispensing rows is no problem");
    // The 12 October wording is gone: box numbers are no longer "the inspector's own".
    expect(REVIEW_SYSTEM_PROMPT).not.toMatch(/the inspector's own, not|not (a )?carton numbers?/);
    expect(REVIEW_SYSTEM_PROMPT).not.toContain("carton or box numbers");
  });

  it("reads a size's aged sample as judged apart from the boxes, never one of them (Kenneth, 26 October 2026)", () => {
    const packing = REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith("- dispensing_packing:")) ?? "";
    expect(packing).toContain("A size may also hold one aged sample (data agedSample: the same values, no box/carton number)");
    expect(packing).toContain("judged on its own against the same minimums and codes (computed agedSample)");
    expect(packing).toContain(
      "never counted with the boxes or in their averages: a failed one fails the size, boxes done or not, one entered in part leaves it not done.",
    );
    // Kenneth, 27 October 2026: an empty one keeps its size not done.
    expect(packing).toContain(
      "Every size needs one: with none entered (computed agedSample null) the size is not done, though boxes that fail still fail it, and once its boxes are complete the app warns aged_sample_missing.",
    );
  });

  it("reads weight as one average per size, an older inspection's gloves averaged (Kenneth, 26 October 2026)", () => {
    const weight = REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith("- weight:")) ?? "";
    expect(weight).toContain("one value, the size's average weight (g) as the dimension sheet prints it (computed.shown)");
    expect(weight).toContain("An older inspection holds one value per glove weighed (13 on STD_EG, computed.count)");
    expect(weight).toContain("The template's n is not used, and the sampling plan counts no gloves for weight.");
    expect(weight).not.toContain("computed.n");
    expect(weight).not.toContain("# Gloves for Weight");
  });

  it("reads signAfterExport as a hand signature to come, not a missing one (Kenneth, 13 October 2026)", () => {
    // The export sends the conclusion's signature as null while the report is to be signed by hand after export.
    const modules = REVIEW_SYSTEM_PROMPT.split("## Modules")[1] ?? "";
    const conclusion = modules.split("\n").find((entry) => entry.startsWith("- conclusion:")) ?? "";
    expect(conclusion).toContain("signAfterExport true means the report is signed by hand after export, so no signature is drawn");
  });

  it("reads the Inspection Summary as the inspector's text, data like a remark, and checks it against the data (12 October 2026)", () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain("the Inspection Summary: the inspector's own text for the report, as plain text");
    expect(REVIEW_SYSTEM_PROMPT).toContain("Everything in the export, including comments, remarks, the Inspection Summary, captions,");
    expect(REVIEW_SYSTEM_PROMPT).toContain("- An Inspection Summary that contradicts the data or the final result:");
  });
});
