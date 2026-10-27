// The counts above the list, as server-rendered markup: each status a link to
// the list filtered to it that keeps the other filters, the chosen one marked
// and leading back to every status, this month's a figure, and a dash where a
// count could not be read.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InspectionCounts } from "@/lib/inspections/query";
import type { InspectionListFilters } from "@/lib/inspections/search-params";
import { InspectionMetrics } from "./inspection-metrics";

const CLIENT = "20000000-0000-4000-8000-000000000001";

const COUNTS: InspectionCounts = {
  byStatus: { draft: 3, submitted: 12, approved: 1204, reopened: 0 },
  thisMonth: 7,
  month: "2026-10-01",
};

function render(filters: InspectionListFilters, counts: InspectionCounts = COUNTS): string {
  return renderToStaticMarkup(<InspectionMetrics filters={filters} counts={counts} />);
}

/** Each link in order: its status, where it goes and whether it is the chosen one. */
function links(html: string) {
  return [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => ({
    status: /data-status="([^"]*)"/.exec(tag)?.[1],
    href: /href="([^"]*)"/.exec(tag)?.[1].replace(/&amp;/g, "&"),
    current: /aria-current="([^"]*)"/.exec(tag)?.[1],
  }));
}

/** The words, screen-reader text included. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("InspectionMetrics", () => {
  it("links each status to the list filtered to it, in the workflow's order, keeping the other filters from page 1", () => {
    expect(links(render({ q: "PO 7", client: CLIENT, page: 3 }))).toEqual(
      ["draft", "submitted", "reopened", "approved"].map((status) => ({
        status,
        href: `/inspections?q=PO+7&status=${status}&client=${CLIENT}`,
        current: undefined,
      })),
    );
  });

  it("marks the chosen status, which leads back to every status", () => {
    expect(links(render({ status: "reopened", q: "x", page: 2 }))).toEqual([
      { status: "draft", href: "/inspections?q=x&status=draft", current: undefined },
      { status: "submitted", href: "/inspections?q=x&status=submitted", current: undefined },
      { status: "reopened", href: "/inspections?q=x", current: "true" },
      { status: "approved", href: "/inspections?q=x&status=approved", current: undefined },
    ]);
  });

  it("names each tile before its count, the counts with thousands separated", () => {
    expect(text(render({ page: 1 }))).toBe("Drafts 3 Submitted 12 Reopened 0 Approved 1,204 This Month , October 2026 7");
  });

  it("shows this month's count as a figure, not a link, and names the month", () => {
    const html = render({ page: 1 });
    expect(links(html)).toHaveLength(4);
    expect(html).toMatch(/<li [^>]*title="Inspections dated in October 2026"[^>]*><div data-metric="this-month"/);
  });

  it("shows a dash for a count that could not be read, and says so to screen readers", () => {
    const html = render({ page: 1 }, { byStatus: { ...COUNTS.byStatus, submitted: null }, thisMonth: null, month: "2026-10-01" });
    expect(text(html)).toContain("Submitted — Not counted Reopened 0");
    expect(text(html)).toContain("This Month , October 2026 — Not counted");
    expect(html).toContain('<span aria-hidden="true">—</span><span class="sr-only">Not counted</span>');
    // Still a link: the list filters whether or not the count was read.
    expect(links(html).map(({ status }) => status)).toContain("submitted");
  });
});
