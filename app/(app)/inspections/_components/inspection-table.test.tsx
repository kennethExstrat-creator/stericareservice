// Server-rendered markup of the list table: which columns each role gets, the
// cells folded for the iPad, states spelled out in words, and each row's
// actions (Continue, Review or View, and Delete on a draft).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionListRow } from "@/lib/inspections/query";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { InspectionTable } from "./inspection-table";
import type { ListViewer } from "./row-actions";

const INSPECTOR = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const ADMIN = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const AS_INSPECTOR: ListViewer = { id: INSPECTOR, role: "inspector" };
const AS_ADMIN: ListViewer = { id: ADMIN, role: "admin" };

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
  inspectorId: INSPECTOR,
  inspector: "Test Inspector",
};

function render(rows: InspectionListRow[], viewer: ListViewer = AS_INSPECTOR): string {
  return renderToStaticMarkup(<InspectionTable rows={rows} viewer={viewer} caption="x" />);
}

/** The column headings as a screen reader reads them. */
function headers(html: string): string[] {
  return [...html.matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
}

/** The body cells of the first row, in column order. */
function cells(html: string): string[] {
  const row = /<tbody[^>]*>(.*?)<\/tbody>/.exec(html)?.[1] ?? "";
  const first = /<tr[^>]*>(.*?)<\/tr>/.exec(row)?.[1] ?? "";
  return [...first.matchAll(/<t[hd]\b[^>]*>(.*?)<\/t[hd]>/g)].map((match) => match[0]);
}

/** A value folded under another one, shown below the breakpoint `until`. */
function folded(until: "lg" | "xl", text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<span class="[^"]*\\b${until}:hidden\\b[^"]*"><span class="[^"]*" title="${escaped}">${escaped}</span></span>`);
}

describe("InspectionTable", () => {
  it("gives inspectors no Inspector column, and the row actions last", () => {
    const html = render([{ ...ROW, inspector: null }]);
    expect(headers(html)).toEqual(["Ref", "Date", "Client", "Manufacturer", "Product", "PO", "Status", "Result", "Actions"]);
    expect(html).not.toContain("Test Inspector");
  });

  it("gives admins the Inspector column with the name, folded under the date on the iPad", () => {
    const html = render([ROW], AS_ADMIN);
    expect(headers(html).slice(-2)).toEqual(["Inspector", "Actions"]);
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden xl:table-cell[^"]*"[^>]*>Inspector<\/th>/);
    const [ref, date] = cells(html);
    expect(date).toMatch(folded("xl", "Test Inspector"));
    // iPad portrait has no date column: the name joins the ref.
    expect(ref).toMatch(folded("lg", "Test Inspector"));
  });

  it("heads each row with its ref as plain bold text on one line, not a link", () => {
    const html = render([ROW]);
    expect(html).toMatch(
      /<th[^>]*scope="row"[^>]*><span class="block font-semibold whitespace-nowrap tabular-nums">INS-2026-0001<\/span>/,
    );
    const [ref] = cells(html);
    expect(ref).not.toContain("<a ");
    expect(html).toContain('<caption class="sr-only">x</caption>');
  });

  it("writes the date the British way on one line, and under the ref in iPad portrait", () => {
    const html = render([ROW]);
    const [ref, date] = cells(html);
    expect(date).toContain('<time dateTime="2026-10-06" class="block whitespace-nowrap tabular-nums">6 Oct 2026</time>');
    expect(date).toMatch(/^<td[^>]*class="[^"]*hidden lg:table-cell/);
    expect(ref).toMatch(/<span class="[^"]*\blg:hidden\b[^"]*"><time dateTime="2026-10-06"[^>]*>6 Oct 2026<\/time><\/span>/);
  });

  it("folds the PO under the ref, and the manufacturer and product under the client, on the iPad", () => {
    const [ref, , client] = cells(render([ROW]));
    expect(ref).toMatch(folded("xl", "PO PO-0001"));
    expect(client).toMatch(folded("lg", "Manufacturer B · Factory 1"));
    expect(client).toMatch(folded("lg", "Nitrile examination gloves"));
  });

  it("folds the product under the manufacturer for iPad landscape, so it shows on every iPad", () => {
    const [, , , manufacturer, product] = cells(render([ROW]));
    expect(manufacturer).toMatch(/^<td[^>]*class="[^"]*hidden lg:table-cell/);
    expect(manufacturer).toMatch(folded("xl", "Nitrile examination gloves"));
    expect(product).toMatch(/^<td[^>]*class="[^"]*hidden 2xl:fine:table-cell/);
    expect(product).toContain('title="Nitrile examination gloves">Nitrile examination gloves</span>');
  });

  it("puts the result under the status on the iPad, named for screen readers", () => {
    const [, , , , , , status, result] = cells(render([ROW]));
    expect(status).toContain('data-status="submitted"');
    expect(status).toMatch(
      /<span class="relative block xl:hidden"><span class="sr-only">Result: <\/span><span data-slot="status-pill" data-status="fail"/,
    );
    expect(result).toMatch(/^<td[^>]*class="[^"]*hidden xl:table-cell/);
    expect(result).toContain('data-status="fail"');
  });

  it("gives every value without a column of its own on the iPad a place that shows", () => {
    // Columns of their own from 1024 px (lg) or only in the desktop layout (xl): header and cell each.
    const asInspector = render([{ ...ROW, inspector: null }]);
    expect(asInspector.match(/hidden lg:table-cell/g)).toHaveLength(4); // date and manufacturer
    expect(asInspector.match(/hidden xl:table-cell/g)).toHaveLength(4); // PO and result
    const asAdmin = render([ROW], AS_ADMIN);
    expect(asAdmin.match(/hidden xl:table-cell/g)).toHaveLength(6); // PO, result and inspector
  });

  it("has the product give way on desktops narrower than 1536 px for every role", () => {
    for (const viewer of [AS_INSPECTOR, AS_ADMIN]) {
      const html = render([ROW], viewer);
      expect(html).toMatch(/<th[^>]*class="[^"]*hidden 2xl:fine:table-cell[^"]*"[^>]*>Product<\/th>/);
      expect(html.match(/hidden 2xl:fine:table-cell/g)).toHaveLength(2); // the product's header and cell
      const [, , , manufacturer] = cells(html);
      // On the iPad the product still shows, under the manufacturer.
      expect(manufacturer).toMatch(folded("xl", "Nitrile examination gloves"));
    }
  });

  it("wraps long names onto a second line on touch and keeps one line with a tooltip for a mouse", () => {
    const html = render([ROW], AS_ADMIN);
    const [, , client, manufacturer, product, po, , , inspector] = cells(html);
    for (const cell of [client, manufacturer, product, po, inspector]) {
      expect(cell).toMatch(
        /<span class="block truncate touch:line-clamp-2 touch:whitespace-normal touch:break-words" title="[^"]+">/,
      );
    }
    // A breakpoint never hides the element that wraps: touch:line-clamp-2 sets display and would win.
    expect(html).not.toMatch(/class="[^"]*(lg|xl):hidden[^"]*line-clamp|class="[^"]*line-clamp[^"]*(lg|xl):hidden/);
  });

  it("lays the table out at fixed widths so it never scrolls sideways, with room for the actions", () => {
    const html = render([ROW], AS_ADMIN);
    expect(html).toMatch(/<table[^>]*class="[^"]*table-fixed/);
    expect(html).toMatch(/<th[^>]*class="[^"]*w-40 fine:w-32[^"]*"[^>]*>Ref<\/th>/);
    expect(html).toMatch(/<th[^>]*class="[^"]*w-46 fine:w-37[^"]*"[^>]*><span class="sr-only">Actions<\/span><\/th>/);
  });

  it("gives the PO its full width in an inspector's list, and 16 px less in admins', which has the Inspector column", () => {
    expect(render([ROW])).toMatch(/<th[^>]*class="[^"]*w-36 fine:w-32[^"]*"[^>]*>PO<\/th>/);
    expect(render([ROW], AS_ADMIN)).toMatch(/<th[^>]*class="[^"]*w-36 fine:w-28[^"]*"[^>]*>PO<\/th>/);
  });

  it("shows Not done until the final result is set, never a pass", () => {
    const html = render([{ ...ROW, status: "draft", result: null }]);
    expect(html).toContain('data-status="not_done"');
    expect(html).toContain("Not done");
    expect(html).not.toContain('data-status="pass"');
  });

  it("says when a value is missing instead of leaving a blank", () => {
    const html = render([{ ...ROW, client: null, manufacturer: null, product: null, po: null }]);
    for (const label of ["No client yet", "No manufacturer yet", "No product yet", "No PO yet"]) {
      expect(html).toContain(`<span class="sr-only">${label}</span>`);
    }
    expect(html).not.toContain(">PO <");
  });
});

describe("the row actions", () => {
  const STATUSES = ["draft", "submitted", "reopened", "approved"] as const;
  const ID = ROW.id;
  const CAPTURE = `/inspections/${ID}`;
  const REVIEW = `/inspections/${ID}/review`;

  type Actions = { href: string; name: string; text: string; tag: string; kind: string; deleteButton: string | null };

  /** The last cell of the first row: the main action's link and the Delete button, if any. */
  function actions(html: string): Actions {
    const cell = cells(html).at(-1) ?? "";
    const link = /(<a [^>]*>)(.*?)<\/a>/.exec(cell);
    if (!link) throw new Error("no link in the actions cell");
    return {
      tag: link[1],
      href: /href="([^"]*)"/.exec(link[1])?.[1] ?? "",
      name: /aria-label="([^"]*)"/.exec(link[1])?.[1] ?? "",
      kind: /data-action="([^"]*)"/.exec(link[1])?.[1] ?? "",
      text: link[2].replace(/<[^>]+>/g, ""),
      deleteButton: /<button[^>]*>/.exec(cell)?.[0] ?? null,
    };
  }

  function forStatus(status: (typeof STATUSES)[number], viewer: ListViewer, inspectorId = INSPECTOR) {
    return actions(render([{ ...ROW, status, inspectorId }], viewer));
  }

  it("offers the inspector Continue while their inspection can change, View once it is submitted", () => {
    const seen = Object.fromEntries(STATUSES.map((status) => [status, forStatus(status, AS_INSPECTOR)]));
    expect(seen.draft).toMatchObject({ text: "Continue", href: CAPTURE, kind: "continue" });
    expect(seen.reopened).toMatchObject({ text: "Continue", href: CAPTURE, kind: "continue" });
    expect(seen.submitted).toMatchObject({ text: "View", href: REVIEW, kind: "view" });
    expect(seen.approved).toMatchObject({ text: "View", href: REVIEW, kind: "view" });
  });

  it("offers an admin Continue on any open inspection, Review on a submitted one, View on an approved one", () => {
    const seen = Object.fromEntries(STATUSES.map((status) => [status, forStatus(status, AS_ADMIN)]));
    expect(seen.draft).toMatchObject({ text: "Continue", href: CAPTURE });
    expect(seen.reopened).toMatchObject({ text: "Continue", href: CAPTURE });
    expect(seen.submitted).toMatchObject({ text: "Review", href: REVIEW, kind: "review" });
    expect(seen.approved).toMatchObject({ text: "View", href: REVIEW });
  });

  it("offers View, never Continue, on an inspection the viewer may not edit", () => {
    const someoneElses = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
    for (const status of ["draft", "reopened"] as const) {
      expect(forStatus(status, AS_INSPECTOR, someoneElses), status).toMatchObject({ text: "View", href: REVIEW });
    }
  });

  it("names each action with the ref, starting with the words on the button", () => {
    for (const [status, viewer, name] of [
      ["draft", AS_INSPECTOR, "Continue INS-2026-0001"],
      ["submitted", AS_ADMIN, "Review INS-2026-0001"],
      ["approved", AS_INSPECTOR, "View INS-2026-0001"],
    ] as const) {
      const action = forStatus(status, viewer);
      expect(action.name).toBe(name);
      expect(action.name.startsWith(action.text)).toBe(true);
    }
  });

  it("offers Delete on a draft only, to its inspector and to admins", () => {
    for (const status of STATUSES) {
      const own = forStatus(status, AS_INSPECTOR).deleteButton;
      const asAdmin = forStatus(status, AS_ADMIN).deleteButton;
      if (status === "draft") {
        expect(own).toContain('aria-label="Delete INS-2026-0001"');
        expect(asAdmin).toContain('aria-label="Delete INS-2026-0001"');
      } else {
        expect(own, status).toBeNull();
        expect(asAdmin, status).toBeNull();
      }
    }
    // Another inspector's draft, should the list ever show one: no Delete.
    expect(forStatus("draft", AS_INSPECTOR, "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9").deleteButton).toBeNull();
  });

  it("makes Delete a real button that asks first, 44 px on touch", () => {
    const { deleteButton } = forStatus("draft", AS_INSPECTOR);
    expect(deleteButton).toContain('type="button"');
    expect(deleteButton).toContain('title="Delete INS-2026-0001"');
    expect(deleteButton).toMatch(/class="[^"]*\bsize-8\b[^"]*\btouch:size-11\b/);
    // Only the main action is a link: Delete opens a dialog.
    expect(cells(render([{ ...ROW, status: "draft" }])).at(-1)?.match(/<a /g)).toHaveLength(1);
  });

  it("gives the main action 44 px and 16 px text on touch, one width down the list, and focus-ring", () => {
    const { tag } = forStatus("draft", AS_INSPECTOR);
    expect(tag).toMatch(/\btouch:h-11\b/);
    expect(tag).toMatch(/\btouch:text-base\b/);
    expect(tag).toMatch(/\bmin-w-21 touch:min-w-25\b/);
    expect(tag).toMatch(/\bfocus-ring\b/);
    expect(tag).toContain('data-row-action="primary"');
  });

  it("calls attention to work waiting (Continue, Review) and keeps View quiet", () => {
    expect(forStatus("draft", AS_INSPECTOR).tag).toContain('data-variant="secondary"');
    expect(forStatus("submitted", AS_ADMIN).tag).toContain('data-variant="secondary"');
    expect(forStatus("approved", AS_ADMIN).tag).toContain('data-variant="outline"');
  });

  it("dims the list while the inspection opens, like the list's own links", () => {
    const html = render([ROW]);
    expect(html).toMatch(/<a [^>]*>View<span aria-hidden="true" hidden=""><\/span><\/a>/);
  });

  it("marks each row with its id, for the focus after a deletion", () => {
    const second = { ...ROW, id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0002", refNo: "INS-2026-0002" };
    const html = render([ROW, second], AS_ADMIN);
    expect(html.match(/<tr[^>]*data-id="[^"]+"/g)).toHaveLength(2);
    expect(html).toContain(`data-id="${second.id}" data-ref="INS-2026-0002"`);
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
