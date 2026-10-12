import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/offline/stable-json";
import type { InspectionData } from "@/modules/_framework";
import { summaryBasisHash, summaryTextHash } from "./summary-basis";

const summary = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The lot PASSED." }] }] };

function data(conclusion: Record<string, unknown> | undefined, weight = 2.9): InspectionData {
  return {
    modules: { weight: { sizes: { M: { average: weight } } }, ...(conclusion ? { conclusion } : {}) },
    custom: {},
  };
}

describe("summaryBasisHash", () => {
  it("leaves the Inspection Summary out: writing, editing or clearing it changes nothing", () => {
    const empty = summaryBasisHash(data({ finalResult: "pass", inspectionSummary: null }));
    expect(summaryBasisHash(data({ finalResult: "pass", inspectionSummary: summary }))).toBe(empty);
    expect(summaryBasisHash(data({ finalResult: "pass" }))).toBe(empty);
  });

  it("changes with anything else in the inspection, the conclusion included", () => {
    const basis = summaryBasisHash(data({ finalResult: "pass", inspectionSummary: summary }));
    expect(summaryBasisHash(data({ finalResult: "hold", inspectionSummary: summary }))).not.toBe(basis);
    expect(summaryBasisHash(data({ finalResult: "pass", inspectionSummary: summary }, 3.1))).not.toBe(basis);
  });

  it("is the data's own hash without a conclusion, whatever the key order", () => {
    expect(summaryBasisHash(data(undefined))).toBe(contentHash(data(undefined)));
    const reordered: InspectionData = { custom: {}, modules: { conclusion: { inspectionSummary: summary, finalResult: "pass" }, weight: { sizes: { M: { average: 2.9 } } } } };
    expect(summaryBasisHash(reordered)).toBe(summaryBasisHash(data({ finalResult: "pass", inspectionSummary: null })));
    expect(summaryBasisHash(reordered)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("summaryTextHash", () => {
  it("hashes the plain text, trimmed", () => {
    expect(summaryTextHash(" The lot PASSED.\n")).toBe(summaryTextHash("The lot PASSED."));
    expect(summaryTextHash("The lot PASSED.")).not.toBe(summaryTextHash("The lot FAILED."));
  });
});
