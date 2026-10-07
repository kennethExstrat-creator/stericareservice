// Server-rendered markup of the list table: which columns each role gets, one
// value per cell on one line, the sideways scroller with the ref and the
// actions pinned, states spelled out in words, and each row's actions
// (Continue, Review or View, and Delete on a draft).
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
const LEAD = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const AS_LEAD: ListViewer = { id: LEAD, role: "inspector", isLead: true };

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

describe("InspectionTable", () => {
  it("gives inspectors no Inspector column, and the row actions last", () => {
    const html = render([{ ...ROW, inspector: null }]);
    expect(headers(html)).toEqual(["Ref", "Status", "Result", "Date", "Client", "Manufacturer", "Product", "PO", "Actions"]);
    expect(html).not.toContain("Test Inspector");
  });

  it("gives admins and lead inspectors the Inspector in charge column, with the name in its own cell", () => {
    for (const viewer of [AS_ADMIN, AS_LEAD]) {
      const html = render([ROW], viewer);
      expect(headers(html)).toEqual([
        "Ref",
        "Status",
        "Result",
        "Date",
        "Client",
        "Manufacturer",
        "Product",
        "PO",
        "Inspector in charge",
        "Actions",
      ]);
      expect(cells(html)[8]).toContain('title="Test Inspector">Test Inspector</span>');
    }
  });

  it("heads each row with its ref as plain text, pinned on the left", () => {
    const [ref] = cells(render([ROW]));
    expect(ref).toMatch(/^<th[^>]*scope="row"[^>]*>/);
    expect(ref).toMatch(/class="[^"]*\bsticky left-0\b/);
    expect(ref).toContain('<span class="font-semibold tabular-nums">INS-2026-0001</span>');
    expect(ref).not.toContain("<a ");
  });

  it("puts every value in its own column, one per cell, with nothing folded under another", () => {
    const html = render([ROW], AS_ADMIN);
    const [ref, status, result, date, client, manufacturer, product, po, inspector] = cells(html);
    const text = (cellHtml: string) => cellHtml.replace(/<[^>]+>/g, "");
    expect(text(ref)).toBe("INS-2026-0001");
    expect(date).toContain('<time dateTime="2026-10-06" class="tabular-nums">6 Oct 2026</time>');
    expect(text(date)).toBe("6 Oct 2026");
    expect(text(client)).toBe("Client A");
    expect(text(manufacturer)).toBe("Manufacturer B · Factory 1");
    expect(text(product)).toBe("Nitrile examination gloves");
    expect(text(po)).toBe("PO-0001");
    expect(status).toContain('data-status="submitted"');
    expect(status).not.toContain("status-pill");
    expect(result).toContain('data-slot="status-pill" data-status="fail"');
    expect(text(inspector)).toBe("Test Inspector");
    // No breakpoint hides a column or a value any more.
    expect(html).not.toMatch(/\b(?:lg|xl|2xl):(?:hidden|table-cell)\b|\bhidden (?:lg|xl|2xl)/);
  });

  it("keeps every row on one line: no wrapping, a long name cut past 24rem with the full text in its tooltip", () => {
    const html = render([ROW], AS_ADMIN);
    expect(html).toMatch(/<table[^>]*class="[^"]*\bwhitespace-nowrap\b/);
    expect(html).not.toMatch(/line-clamp|whitespace-normal|break-words/);
    expect(html).toContain('<span class="block max-w-96 truncate" title="Manufacturer B · Factory 1">');
  });

  it("scrolls sideways inside a card that takes the focus, with the actions pinned on the right", () => {
    const html = render([ROW], AS_ADMIN);
    expect(html).toMatch(/^<div role="region" aria-label="x" tabindex="0" data-slot="table-scroller"[^>]*class="[^"]*\boverflow-x-auto\b[^"]*\boverscroll-x-contain\b/);
    // Positioned, so the sr-only text in its cells is clipped by the card instead of widening the page.
    expect(html).toMatch(/^<div [^>]*data-slot="table-scroller"[^>]*class="[^"]*\brelative\b/);
    expect(html).toMatch(/<table[^>]*class="[^"]*\bw-max min-w-full\b/);
    expect(html).toMatch(/<table[^>]*class="[^"]*\bborder-separate\b/);
    expect(cells(html).at(-1)).toMatch(/^<td[^>]*class="[^"]*\bsticky right-0\b/);
    expect(html).toMatch(/<th[^>]*class="[^"]*\bsticky right-0\b[^"]*"[^>]*><span class="sr-only">Actions<\/span><\/th>/);
    // The pinned cells are opaque, so what scrolls under them never shows through.
    for (const pinned of [cells(html)[0], cells(html).at(-1)!]) expect(pinned).toMatch(/\bbg-card\b/);
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

  it("offers a lead inspector only View on their team's inspections, in every status, and never Delete", () => {
    for (const status of STATUSES) {
      expect(forStatus(status, AS_LEAD), status).toMatchObject({ text: "View", href: REVIEW, kind: "view", deleteButton: null });
    }
    // Their own draft: Continue and Delete, as for any inspector.
    const own = forStatus("draft", AS_LEAD, LEAD);
    expect(own).toMatchObject({ text: "Continue", href: CAPTURE });
    expect(own.deleteButton).toContain('aria-label="Delete INS-2026-0001"');
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
