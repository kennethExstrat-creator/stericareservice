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
});
