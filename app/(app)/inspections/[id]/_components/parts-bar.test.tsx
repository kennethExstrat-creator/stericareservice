// The PO parts bar, the header of a part and Add PO's form, drawn on the
// server: which part is open, where the others link, whose status shows, and
// Add PO only where a PO may be added. Switching parts and adding one in the
// browser are for e2e.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
  // The screen keeps the open page in the address (?module=).
  useSearchParams: () => new URLSearchParams("module=glove_info"),
}));
vi.mock("../parts-actions", () => ({ addInspectionPart: vi.fn() }));

import { Dialog } from "@/components/ui/dialog";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import type { InspectionPart } from "@/lib/inspections/parts";
import { AddPartForm } from "./add-part-dialog";
import { CaptureHeader, type CaptureHeading } from "./capture-header";
import { PartsBar } from "./parts-bar";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

/** Three POs, first part first; the third has no PO number yet and was submitted on its own. */
const PARTS: InspectionPart[] = [
  { id: FIRST, refNo: "INS-2026-0001", poNo: "1000001", productName: null, status: "draft", primary: true },
  { id: SECOND, refNo: "INS-2026-0004", poNo: "1000002", productName: null, status: "draft", primary: false },
  { id: THIRD, refNo: "INS-2026-0007", poNo: null, productName: null, status: "submitted", primary: false },
];

const HEADING: CaptureHeading = {
  refNo: "INS-2026-0004",
  status: "draft",
  templateName: "Standard examination gloves",
  templateVersion: 3,
  clientName: "Client A",
  manufacturerLabel: "Manufacturer A · Factory 1",
  manufacturerName: "Manufacturer A",
  inspectionDate: "2026-10-06",
  inspectorName: "Inspector A",
  parts: { list: PARTS, currentId: SECOND, canAdd: true },
};

const linkHrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The part line under the title. */
const partLine = (html: string) => textOf(/<p[^>]*data-slot="capture-part"[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? "");

function bar(props: Partial<Parameters<typeof PartsBar>[0]> = {}): string {
  return renderToStaticMarkup(
    <PartsBar parts={PARTS} currentId={SECOND} status="draft" canAdd refNo="INS-2026-0001" {...props} />,
  );
}

describe("PartsBar", () => {
  it("lists the parts in order, the open one marked and no link, the others opening on the same page", () => {
    const html = bar();
    expect(html).toContain('<nav aria-label="POs in this inspection"');
    expect([...html.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1])).toEqual([FIRST, SECOND, THIRD]);
    expect(html).toMatch(new RegExp(`<span aria-current="page" data-part="${SECOND}"[^>]*><span[^>]*>PO 1000002</span>`));
    expect(linkHrefs(html)).toEqual([`/inspections/${FIRST}?module=glove_info`, `/inspections/${THIRD}?module=glove_info`]);
    // A part without a PO number yet is named by its place.
    expect(textOf(html)).toContain("PO 3");
  });

  it("shows another part's status only where it differs from the open part's", () => {
    const statuses = [...bar().matchAll(/data-slot="inspection-status" data-status="([a-z]+)"/g)].map((match) => match[1]);
    expect(statuses).toEqual(["submitted"]);
  });

  it("marks the part it is leaving for while the last change is saved", () => {
    const html = bar({ leavingTo: `/inspections/${FIRST}?module=glove_info` });
    expect(html).toMatch(new RegExp(`<a [^>]*aria-busy="true"[^>]*data-part="${FIRST}"`));
    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
  });

  it("offers Add PO only where a PO may be added", () => {
    expect(bar()).toMatch(/<button[^>]*data-action="add-part"[^>]*>.*Add PO<\/button>/);
    expect(bar({ canAdd: false })).not.toContain('data-action="add-part"');
  });
});

describe("CaptureHeader with PO parts", () => {
  it("titles every part with the inspection's reference, and says which part this is", () => {
    const html = renderToStaticMarkup(<CaptureHeader heading={HEADING} />);
    expect(html).toMatch(/<h1[^>]*>.*INS-2026-0001.*<\/h1>/);
    expect(/<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1]).not.toContain("INS-2026-0004");
    // The part's own reference, small, beside it.
    expect(partLine(html)).toBe("PO 1000002 · Part 2 of 3 INS-2026-0004");
    expect(lowerCaseWords("Part 2 of 3")).toEqual([]);
    expect(html).toContain('data-slot="capture-parts"');
  });

  it("does not repeat the first part's reference, which is the title", () => {
    const html = renderToStaticMarkup(<CaptureHeader heading={{ ...HEADING, refNo: "INS-2026-0001", parts: { ...HEADING.parts!, currentId: FIRST } }} />);
    expect(partLine(html)).toBe("PO 1000001 · Part 1 of 3");
  });

  it("stays as it was for one PO, with the bar only to add a second", () => {
    const one = { list: PARTS.slice(0, 1), currentId: FIRST, canAdd: true };
    const html = renderToStaticMarkup(<CaptureHeader heading={{ ...HEADING, refNo: "INS-2026-0001", parts: one }} />);
    expect(html).not.toContain('data-slot="capture-part"');
    expect(html).toContain('data-action="add-part"');
    const readOnly = renderToStaticMarkup(<CaptureHeader heading={{ ...HEADING, refNo: "INS-2026-0001", parts: { ...one, canAdd: false } }} />);
    expect(readOnly).not.toContain('data-slot="capture-parts"');
    // Parts that could not be read: this part alone, under its own reference.
    const unread = renderToStaticMarkup(<CaptureHeader heading={{ ...HEADING, parts: null }} />);
    expect(unread).toMatch(/<h1[^>]*>.*INS-2026-0004.*<\/h1>/);
    expect(unread).not.toContain('data-slot="capture-parts"');
  });

  it("takes Add PO away once the last save finds the inspection submitted", () => {
    const html = renderToStaticMarkup(<CaptureHeader heading={{ ...HEADING, status: "submitted" }} />);
    expect(html).toContain('data-slot="capture-parts"');
    expect(html).not.toContain('data-action="add-part"');
  });
});

describe("AddPartForm", () => {
  const html = renderToStaticMarkup(
    <Dialog open>
      <AddPartForm inspectionId={SECOND} refNo="INS-2026-0001" onPendingChange={() => {}} onAdded={() => {}} />
    </Dialog>,
  );

  it("asks for the PO / SO number, optional, no longer than the header keeps it", () => {
    expect(textOf(html)).toContain("Add a PO to INS-2026-0001");
    const input = /<input[^>]*>/.exec(html)?.[0] ?? "";
    const id = /\sid="([^"]+)"/.exec(input)?.[1];
    expect(new RegExp(`<label[^>]*for="${id}"[^>]*>PO / SO Number \\(Optional\\)</label>`).test(html)).toBe(true);
    expect(input).toContain('name="poNo"');
    expect(input).toContain('maxLength="2000"');
    expect(input).toContain('autoCorrect="off"');
  });

  it("offers Cancel and Add PO, in Title Case", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Add PO<\/button>/);
    for (const label of ["Add a PO to INS-2026-0001", "PO / SO Number (Optional)", "Add PO", "Cancel"]) {
      expect(lowerCaseWords(label), label).toEqual([]);
    }
  });
});
