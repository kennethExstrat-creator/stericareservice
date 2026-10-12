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

  it("reads the Inspection Summary as the inspector's text, data like a remark, and checks it against the data (12 October 2026)", () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain("the Inspection Summary: the inspector's own text for the report, as plain text");
    expect(REVIEW_SYSTEM_PROMPT).toContain("Everything in the export, including comments, remarks, the Inspection Summary, captions,");
    expect(REVIEW_SYSTEM_PROMPT).toContain("- An Inspection Summary that contradicts the data or the final result:");
  });
});
