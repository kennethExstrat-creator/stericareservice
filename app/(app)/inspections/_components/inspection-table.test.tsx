// Server-rendered markup of the list table: which columns each role gets, one
// value per cell on one line, the sideways scroller with the ref and the
// actions pinned, states spelled out in words, each row's actions (Continue,
// Review or View, and Delete on a draft), and an inspection of several POs
// as one row.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionListPart, InspectionListRow } from "@/lib/inspections/query";
import { InspectionStatusBadge } from "./inspection-status-badge";
import { InspectionTable, PoPartsList } from "./inspection-table";
import type { ListViewer } from "./row-actions";

const INSPECTOR = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const ADMIN = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const AS_INSPECTOR: ListViewer = { id: INSPECTOR, role: "inspector" };
const AS_ADMIN: ListViewer = { id: ADMIN, role: "admin" };
const LEAD = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const AS_LEAD: ListViewer = { id: LEAD, role: "inspector", isLead: true };

const FIRST_PART: InspectionListPart = {
  id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001",
  refNo: "INS-2026-0001",
  poNo: "PO-0001",
  productName: "Nitrile examination gloves",
  status: "submitted",
  result: "fail",
};

const ROW: InspectionListRow = {
  id: FIRST_PART.id,
  refNo: "INS-2026-0001",
  inspectionDate: "2026-10-06",
  client: "Client A",
  manufacturer: "Manufacturer B · Factory 1",
  product: "Nitrile examination gloves",
  po: "PO-0001",
  status: "submitted",
  statusMixed: false,
  result: "fail",
  resultMixed: false,
  inspectorId: INSPECTOR,
  inspector: "Test Inspector",
  parts: [FIRST_PART],
};

/** An inspection of three POs, the last without its PO number yet, as listInspections() sums it. */
const THREE_POS: InspectionListRow = {
  ...ROW,
  status: "draft",
  statusMixed: true,
  result: null,
  resultMixed: true,
  parts: [
    { ...FIRST_PART, status: "reopened", result: "pass" },
    {
      ...FIRST_PART,
      id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0002",
      refNo: "INS-2026-0002",
      poNo: "PO-0002",
      status: "draft",
      result: null,
    },
    {
      ...FIRST_PART,
      id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0003",
      refNo: "INS-2026-0003",
      poNo: null,
      productName: null,
      status: "draft",
      result: null,
    },
  ],
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

  it("gives admins and lead inspectors the Inspector in Charge column, with the name in its own cell", () => {
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
        "Inspector in Charge",
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

  it("shows Not Done until the final result is set, never a pass", () => {
    const html = render([{ ...ROW, status: "draft", result: null }]);
    expect(html).toContain('data-status="not_done"');
    expect(html).toContain("Not Done");
    expect(html).not.toContain('data-status="pass"');
  });

  it("says when a value is missing instead of leaving a blank", () => {
    const html = render([{ ...ROW, client: null, manufacturer: null, product: null, po: null }]);
    for (const label of ["No Client", "No manufacturer yet", "No product yet", "No PO yet"]) {
      expect(html).toContain(`<span class="sr-only">${label}</span>`);
    }
    expect(html).not.toContain(">PO <");
  });
});

describe("an inspection of several POs", () => {
  const text = (cellHtml: string) => cellHtml.replace(/<[^>]+>/g, "");

  it("is one row, its first part's, with the first PO and +2 POs", () => {
    const html = render([THREE_POS], AS_ADMIN);
    expect(html.match(/<tr[^>]*data-id="[^"]+"/g)).toHaveLength(1);
    expect(html).toContain(`data-id="${ROW.id}" data-ref="INS-2026-0001"`);
    const [ref, , , , , , , po] = cells(html);
    expect(text(ref)).toBe("INS-2026-0001");
    // The first PO, its tooltip listing every PO, then the button; on one line like every cell.
    expect(po).toContain('title="PO PO-0001, PO PO-0002, PO 3">PO-0001</span>');
    expect(text(po)).toBe("PO-0001+2 POs in INS-2026-0001");
  });

  it("opens every PO from +2 POs: a real button, 24 px with a mouse and 44 px with 16 px text on touch", () => {
    const [, , , , , , , po] = cells(render([THREE_POS]));
    const button = /<button[^>]*>/.exec(po)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('data-row-action="parts"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toMatch(/class="[^"]*\bh-6\b/);
    expect(button).toMatch(/class="[^"]*\btouch:h-11\b/);
    expect(button).toMatch(/class="[^"]*\btouch:text-base\b/);
    expect(button).toMatch(/class="[^"]*\bfocus-ring\b/);
  });

  it("says when the first part has no PO number yet, and still counts the others", () => {
    const html = render([{ ...THREE_POS, po: null }]);
    const [, , , , , , , po] = cells(html);
    expect(po).toContain('<span class="sr-only">No PO yet</span>');
    expect(text(po)).toContain("+2 POs");
  });

  it("says Mixed beside the status and the result when the POs differ, each PO's in the tooltip", () => {
    const [, status, result] = cells(render([THREE_POS]));
    expect(status).toContain('data-status="draft"');
    expect(status).toMatch(/title="PO PO-0001: Reopened, PO PO-0002: Draft, PO 3: Draft"[^>]*>Mixed<\/span>/);
    expect(result).toContain('data-status="not_done"');
    expect(result).toMatch(/title="PO PO-0001: Passed, PO PO-0002: Not Done, PO 3: Not Done"[^>]*>Mixed<\/span>/);
    // 14 px on touch, beside the 14 px pills; slate-600, the lightest secondary text allowed.
    expect(status).toMatch(/data-slot="mixed"[^>]*class="[^"]*\btext-slate-600\b[^"]*\btouch:text-sm\b/);
  });

  it("says nothing more when the POs agree", () => {
    const together: InspectionListRow = {
      ...ROW,
      parts: [FIRST_PART, { ...FIRST_PART, id: "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0002", poNo: "PO-0002" }],
    };
    const [, status, result, , , , , po] = cells(render([together]));
    expect(status + result).not.toContain("Mixed");
    expect(text(po)).toBe("PO-0001+1 PO in INS-2026-0001");
  });

  it("keeps an inspection of one PO as it was: no Mixed, no button", () => {
    const html = render([ROW], AS_ADMIN);
    expect(html).not.toContain("Mixed");
    expect(html).not.toContain('data-row-action="parts"');
    expect(cells(html)[7]).toContain('<span class="block max-w-96 truncate" title="PO-0001">PO-0001</span>');
  });

  it("offers no Delete on a draft of several POs", () => {
    const parts = THREE_POS.parts.map((part) => ({ ...part, status: "draft" as const }));
    for (const viewer of [AS_INSPECTOR, AS_ADMIN]) {
      const actions = cells(render([{ ...THREE_POS, statusMixed: false, parts }], viewer)).at(-1) ?? "";
      expect(actions).toContain(">Continue<");
      expect(actions).not.toContain('data-row-action="delete"');
    }
  });

  it("lists each PO with its product, status and result", () => {
    const html = renderToStaticMarkup(<PoPartsList parts={THREE_POS.parts} />);
    const items = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
    expect(items).toHaveLength(3);
    expect(text(items[0])).toBe("PO PO-0001Nitrile examination glovesReopenedPassed");
    expect(text(items[1])).toBe("PO PO-0002Nitrile examination glovesDraftNot Done");
    // No PO number yet: named by its place (partLabel). No product yet: none shown.
    expect(text(items[2])).toBe("PO 3DraftNot Done");
    expect(items[0]).toContain('data-slot="inspection-status" data-status="reopened"');
    expect(items[0]).toContain('data-slot="status-pill" data-status="pass"');
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
