// Submit for an inspection of several PO parts, as server-rendered markup:
// the words, and the links to the POs that keep it back. The submit itself
// is covered by actions.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ submitInspection: vi.fn() }));

import type { InspectionPart } from "@/lib/inspections/parts";
import { SubmitError, submitScope, SubmitSummary } from "./submit-control";

const FIRST = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const SECOND = "8d3e5f2b-1c4a-4b6d-8e9f-2a3b4c5d6e7f";
const THIRD = "9e4f6a3c-2d5b-4c7e-9fa0-3b4c5d6e7f80";

const PARTS: InspectionPart[] = [
  { id: FIRST, refNo: "INS-2026-0001", poNo: "2680276", productName: null, status: "draft", primary: true },
  { id: SECOND, refNo: "INS-2026-0002", poNo: "2680277", productName: null, status: "draft", primary: false },
  { id: THIRD, refNo: "INS-2026-0003", poNo: null, productName: null, status: "draft", primary: false },
];

describe("a submit of several POs", () => {
  it("covers every PO under the inspection's reference number, the first part's", () => {
    expect(submitScope(PARTS, SECOND, "INS-2026-0002")).toEqual({
      action: "Submit All 3 POs",
      title: "Submit All 3 POs of INS-2026-0001 for Review?",
      list: "PO 2680276, PO 2680277 and PO 3",
      current: "PO 2680277",
    });
  });

  it("says whose suggestion the summary shows", () => {
    const html = renderToStaticMarkup(
      <SubmitSummary suggested={{ result: "pass", reasons: [] }} warningCount={0} poLabel="PO 2680277" />,
    );
    expect(html).toContain("Suggested Result for PO 2680277");
  });

  it("links each PO that keeps the inspection back, in the alert read out", () => {
    const html = renderToStaticMarkup(
      <SubmitError
        message="Nothing was submitted: PO 2680277 is not ready yet."
        parts={[{ id: SECOND, label: "PO 2680277", message: "1 item is needed in PO 2680277 before you can submit." }]}
      />,
    );
    expect(html).toMatch(/^<div role="alert"/);
    expect(html).toContain("1 item is needed in PO 2680277 before you can submit.");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${SECOND}"[^>]*>Open PO 2680277</a>`));
  });

  it("is the one line it always was without a PO to name", () => {
    const html = renderToStaticMarkup(<SubmitError message="You cannot submit this inspection." />);
    expect(html).toMatch(/^<p role="alert"[^>]*><svg[\s\S]*<\/svg>You cannot submit this inspection.<\/p>$/);
  });
});
