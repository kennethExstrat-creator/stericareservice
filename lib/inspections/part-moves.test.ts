import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import {
  allPartsLabel,
  blockedNote,
  joinWords,
  partsApprovalCautions,
  partVersionValue,
  PartVersionsSchema,
  planReview,
  sameParts,
  type PartState,
} from "./part-moves";

const A = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const B = "4a1d3b2f-6c7e-4f80-9b1c-2d3e4f5a6b7c";
const C = "5b2e4c3a-7d8f-4091-8c2d-3e4f5a6b7c8d";
const VERSION = "2026-10-06T06:05:03.123456+00:00";

function part(id: string, label: string, overrides: Partial<PartState> = {}): PartState {
  return { id, label, refNo: "INS-2026-0001", status: "submitted", version: VERSION, primary: false, result: "pass", suggestedResult: "pass", ...overrides };
}

describe("planReview", () => {
  const parts = [
    part(A, "PO 1"),
    part(B, "PO 2", { status: "approved" }),
    part(C, "PO 3", { status: "draft" }),
    part(A, "PO 4", { status: "reopened" }),
  ];
  const labels = (list: readonly PartState[]) => list.map((entry) => entry.label);

  it("approves the submitted parts, leaves the approved ones, and cannot approve a draft or a reopened part", () => {
    const plan = planReview(parts, "approve");
    expect([labels(plan.move), labels(plan.done), labels(plan.blocked)]).toEqual([["PO 1"], ["PO 2"], ["PO 3", "PO 4"]]);
  });

  it("reopens the submitted parts, leaves those with the inspector already, and cannot reopen an approved part", () => {
    const plan = planReview(parts, "reopen");
    expect([labels(plan.move), labels(plan.done), labels(plan.blocked)]).toEqual([["PO 1"], ["PO 3", "PO 4"], ["PO 2"]]);
  });
});

describe("the words", () => {
  it("lists the POs and says what keeps a decision back", () => {
    expect(joinWords(["PO 1"])).toBe("PO 1");
    expect(joinWords(["PO 1", "PO 2", "PO 3"])).toBe("PO 1, PO 2 and PO 3");
    expect(blockedNote("approve", [part(B, "PO 2", { status: "draft" }), part(C, "PO 3", { status: "reopened" })])).toBe(
      "PO 2 is a draft and PO 3 is reopened: every PO must be submitted before the inspection can be approved.",
    );
    expect(blockedNote("reopen", [part(B, "PO 2", { status: "approved" })])).toBe(
      "PO 2 is approved, so the inspection can no longer be reopened.",
    );
  });

  it("writes the actions as labels", () => {
    for (const label of [`Submit ${allPartsLabel(3)}`, `Approve ${allPartsLabel(2)}`, `Submit ${allPartsLabel(3)} of INS-2026-0001 for Review?`]) {
      expect(lowerCaseWords(label)).toEqual([]);
    }
  });

  it("names each PO's cautions: the page's part with its checks, the others by their results", () => {
    const parts = [part(A, "PO 1"), part(B, "PO 2", { result: null }), part(C, "PO 3", { result: "fail" })];
    expect(partsApprovalCautions(parts, A, { finalResult: "pass", suggestedResult: "fail", errors: 2 })).toEqual([
      "The final result of PO 1 differs from its suggested result.",
      "The checks found 2 errors in PO 1. Reopen it instead if the inspector should fix them first.",
      "The inspector has not chosen a final result for PO 2.",
      "The final result of PO 3 differs from its suggested result.",
    ]);
    expect(partsApprovalCautions(parts.slice(0, 1), A, { finalResult: "pass", suggestedResult: null, errors: null })).toEqual([
      "The results of PO 1 could not be worked out, so nothing was checked. Ask a developer before you approve it.",
    ]);
  });
});

describe("the parts an approve form names", () => {
  it("reads each part's id and version, and nothing else", () => {
    expect(PartVersionsSchema.parse([partVersionValue({ id: A, version: VERSION })])).toEqual([{ id: A, version: VERSION }]);
    expect(PartVersionsSchema.parse([])).toEqual([]);
    for (const value of [`${A}`, `not-an-id@${VERSION}`, `${A}@yesterday`, `${A}@${VERSION}@x`]) {
      expect(PartVersionsSchema.safeParse([value]).success).toBe(false);
    }
  });

  it("matches the parts there are now, in any order, each once", () => {
    const now = [{ id: A }, { id: B }];
    expect(sameParts(now, [{ id: B }, { id: A }])).toBe(true);
    expect(sameParts(now, [{ id: A }])).toBe(false);
    expect(sameParts(now, [{ id: A }, { id: A }])).toBe(false);
    expect(sameParts(now, [{ id: A }, { id: B }, { id: C }])).toBe(false);
  });
});
