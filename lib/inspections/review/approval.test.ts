import { describe, expect, it } from "vitest";
import { evaluated } from "./__fixtures__/review";
import { approvalCautions, approvalChecks } from "./approval";

const NOT_CHECKED = "The results could not be worked out, so nothing was checked. Ask a developer before you approve it.";

describe("approvalChecks", () => {
  it("passes on the suggestion and the errors the checks found", () => {
    // Visual fails size L; carton 2 entered twice for size M is the one error.
    expect(approvalChecks(evaluated())).toEqual({ suggestedResult: "fail", errors: 1 });
  });

  it("has no error count, not 0 errors, when the results could not be worked out", () => {
    expect(approvalChecks(evaluated({ resolved: { broken: true } }))).toEqual({ suggestedResult: null, errors: null });
    expect(approvalChecks(evaluated({ data: "unreadable" }))).toEqual({ suggestedResult: null, errors: null });
  });
});

describe("approvalCautions", () => {
  it("has none when the inspector's result matches the suggestion and the checks found no error", () => {
    expect(approvalCautions({ finalResult: "pass", suggestedResult: "pass", errors: 0 })).toEqual([]);
  });

  it("says when nothing was checked, first, and never reads that as clean", () => {
    expect(approvalCautions({ finalResult: "fail", suggestedResult: null, errors: null })).toEqual([NOT_CHECKED]);
    expect(approvalCautions({ finalResult: null, suggestedResult: null, errors: null })).toEqual([
      NOT_CHECKED,
      "The inspector has not chosen a final result.",
    ]);
  });

  it("points out a missing final result", () => {
    expect(approvalCautions({ finalResult: null, suggestedResult: "hold", errors: 0 })).toEqual([
      "The inspector has not chosen a final result.",
    ]);
  });

  it("points out a final result that differs, and the errors, in words for one and for several", () => {
    expect(approvalCautions({ finalResult: "pass", suggestedResult: "fail", errors: 1 })).toEqual([
      "The final result differs from the suggested result.",
      "The checks found 1 error. Reopen it instead if the inspector should fix it first.",
    ]);
    expect(approvalCautions({ finalResult: "fail", suggestedResult: "fail", errors: 3 })).toEqual([
      "The checks found 3 errors. Reopen it instead if the inspector should fix them first.",
    ]);
  });
});
