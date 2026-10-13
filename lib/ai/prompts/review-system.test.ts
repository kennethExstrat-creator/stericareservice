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

  it("reads box numbers as the inspector's own, never checked against the carton list (Kenneth, 12 October 2026)", () => {
    const line = (key: string) => REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith(`- ${key}:`)) ?? "";
    for (const key of ["dispensing_packing", "dispensing_safedon", "labeling"]) {
      expect(line(key), key).toMatch(/box numbers? the inspector typed/);
      expect(line(key), key).toMatch(/not (a )?carton numbers?/);
    }
    expect(REVIEW_SYSTEM_PROMPT).not.toContain("picked from the carton list");
    expect(REVIEW_SYSTEM_PROMPT).not.toMatch(/not in that size's carton list|boxes not in the carton list/);
    // Carton numbers are still checked, in carton_sampling.
    expect(REVIEW_SYSTEM_PROMPT).toContain("- Carton numbers: duplicates within a size, numbers outside 1 to the order quantity");
  });

  it("weighs the sampling plan's # Gloves for Weight, never the dimension sample (Kenneth, 12 October 2026)", () => {
    const weight = REVIEW_SYSTEM_PROMPT.split("\n").find((entry) => entry.startsWith("- weight:")) ?? "";
    expect(weight).toContain("the sampling plan's # Gloves for Weight for the size (computed.n per size)");
    expect(weight).toContain("the template's n (13 on STD_EG) when the plan gives none; never the dimension sample");
    expect(weight).toContain("one value per size (SAFEDON_EG)");
    expect(weight).not.toContain("glove of the dimension sample");
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
