import { describe, expect, it } from "vitest";
import { parseSourceAnswer } from "./source-reader";

describe("parseSourceAnswer", () => {
  const answer = (extra: Record<string, unknown>) =>
    parseSourceAnswer(`Here it is:\n${JSON.stringify({ summary: "Lab test report.", modules: { tensile: { sizes: {} } }, ...extra })}`);

  it("reads where the file itself belongs, once each, dropping what is not a module key or documents row", () => {
    const parsed = answer({ attachTo: ["tensile", " documents.labTestReports ", "tensile", 42, "drop table", ""] });
    expect(parsed?.attachTo).toEqual(["tensile", "documents.labTestReports"]);
    expect(parsed?.proposals).toEqual({ tensile: { sizes: {} } });
  });

  it("attaches nowhere when the answer has no attachTo, or something else there", () => {
    expect(answer({})?.attachTo).toEqual([]);
    expect(answer({ attachTo: "tensile" })?.attachTo).toEqual([]);
    expect(answer({ attachTo: null })?.summary).toBe("Lab test report.");
  });
});
