// Server-rendered markup of the list table: which columns each role gets, the
// cells folded for iPad portrait, and states spelled out in words.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionListRow } from "@/lib/inspections/query";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { InspectionTable } from "./inspection-table";

const ROW: InspectionListRow = {
  id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001",
  refNo: "INS-2026-0001",
  inspectionDate: "2026-10-06",
  client: "Client A",
  manufacturer: "Manufacturer B · Factory 1",
  product: "Nitrile examination gloves",
  po: "PO-0001",
  status: "submitted",
  result: "fail",
  inspector: "Test Inspector",
};

function headers(html: string): string[] {
  return [...html.matchAll(/<th[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
}

/** The body cells of the first row, in column order. */
function cells(html: string): string[] {
  const row = /<tbody[^>]*>(.*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...row.matchAll(/<t[hd]\b[^>]*>(.*?)<\/t[hd]>/g)].map((match) => match[0]);
}

/** A value folded under another one, shown below the breakpoint `until`. */
function folded(until: "lg" | "xl", text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<span class="[^"]*\\b${until}:hidden\\b[^"]*"><span class="[^"]*" title="${escaped}">${escaped}</span></span>`);
}

describe("InspectionTable", () => {
  it("gives inspectors no Inspector column", () => {
    const html = renderToStaticMarkup(
      <InspectionTable rows={[{ ...ROW, inspector: null }]} role="inspector" caption="Your inspections" />,
    );
    expect(headers(html)).toEqual(["Ref", "Date", "Client", "Manufacturer", "Product", "PO", "Status", "Result"]);
    expect(html).not.toContain("Test Inspector");
  });

  it("gives admins the Inspector column with the name, folded under the date on the iPad", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="admin" caption="All inspections" />);
    expect(headers(html).at(-1)).toBe("Inspector");
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden xl:table-cell[^"]*"[^>]*>Inspector<\/th>/);
    const [, date] = cells(html);
    expect(date).toMatch(folded("xl", "Test Inspector"));
  });

  it("makes the ref the row header and writes the date the British way", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="inspector" caption="Your inspections" />);
    expect(html).toMatch(/<th[^>]*scope="row"[^>]*><span[^>]*>INS-2026-0001<\/span>/);
    expect(html).toContain('<time dateTime="2026-10-06"');
    expect(html).toContain("6 Oct 2026");
    expect(html).toContain('<caption class="sr-only">Your inspections</caption>');
  });

  it("folds the PO, manufacturer and product under the ref and client for iPad portrait", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="inspector" caption="Your inspections" />);
    const [ref, , client] = cells(html);
    expect(ref).toMatch(folded("lg", "PO PO-0001"));
    expect(client).toMatch(folded("lg", "Manufacturer B · Factory 1"));
    expect(client).toMatch(folded("lg", "Nitrile examination gloves"));
    expect(html.match(/hidden lg:table-cell/g)).toHaveLength(4); // manufacturer and PO: header and cell
    expect(html.match(/hidden xl:table-cell/g)).toHaveLength(2); // product: header and cell
  });

  it("folds the product under the manufacturer for iPad landscape, so it shows at every size", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="inspector" caption="Your inspections" />);
    const [, , , manufacturer, product] = cells(html);
    expect(manufacturer).toMatch(/^<td[^>]*class="[^"]*hidden lg:table-cell/);
    expect(manufacturer).toMatch(folded("xl", "Nitrile examination gloves"));
    expect(product).toMatch(/^<td[^>]*class="[^"]*hidden xl:table-cell/);
    expect(product).toContain('title="Nitrile examination gloves">Nitrile examination gloves</span>');
  });

  it("wraps long names onto a second line on touch and keeps one line with a tooltip for a mouse", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="admin" caption="x" />);
    const [, , client, manufacturer, product, po, , , inspector] = cells(html);
    for (const cell of [client, manufacturer, product, po, inspector]) {
      expect(cell).toMatch(
        /<span class="block truncate touch:line-clamp-2 touch:whitespace-normal touch:break-words" title="[^"]+">/,
      );
    }
    // A breakpoint never hides the element that wraps: touch:line-clamp-2 sets display and would win.
    expect(html).not.toMatch(/class="[^"]*(lg|xl):hidden[^"]*line-clamp|class="[^"]*line-clamp[^"]*(lg|xl):hidden/);
  });

  it("lays the table out at fixed widths so it never scrolls sideways", () => {
    const html = renderToStaticMarkup(<InspectionTable rows={[ROW]} role="admin" caption="x" />);
    expect(html).toMatch(/<table[^>]*class="[^"]*table-fixed/);
    expect(html).toMatch(/<th[^>]*class="[^"]*w-40 fine:w-34[^"]*"[^>]*>Ref<\/th>/);
  });

  it("shows Not done until the final result is set, never a pass", () => {
    const html = renderToStaticMarkup(
      <InspectionTable rows={[{ ...ROW, status: "draft", result: null }]} role="inspector" caption="x" />,
    );
    expect(html).toContain('data-status="not_done"');
    expect(html).toContain("Not done");
    expect(html).not.toContain('data-status="pass"');
  });

  it("says when a value is missing instead of leaving a blank", () => {
    const html = renderToStaticMarkup(
      <InspectionTable
        rows={[{ ...ROW, client: null, manufacturer: null, product: null, po: null }]}
        role="inspector"
        caption="x"
      />,
    );
    for (const label of ["No client yet", "No manufacturer yet", "No product yet", "No PO yet"]) {
      expect(html).toContain(`<span class="sr-only">${label}</span>`);
    }
    expect(html).not.toContain(">PO <");
  });
});

describe("InspectionStatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["submitted", "Submitted"],
    ["approved", "Approved"],
    ["reopened", "Reopened"],
  ] as const)("spells out %s with an icon", (status, label) => {
    const html = renderToStaticMarkup(<InspectionStatusBadge status={status} />);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain(`<span>${label}</span>`);
  });

  it.each(["draft", "submitted", "approved", "reopened"] as const)(
    "keeps the result colours for results: %s uses none of them",
    (status) => {
      const html = renderToStaticMarkup(<InspectionStatusBadge status={status} />);
      expect(html).not.toMatch(/\b(?:text|bg|border|ring|outline|fill|stroke)-(?:pass|fail|warn|hold|info|not-done)\b/);
    },
  );

  it("tells the four states apart by look as well as by word", () => {
    const looks = (["draft", "submitted", "approved", "reopened"] as const).map(
      (status) => /<span[^>]*class="([^"]*)"/.exec(renderToStaticMarkup(<InspectionStatusBadge status={status} />))?.[1],
    );
    expect(new Set(looks).size).toBe(4);
  });
});
