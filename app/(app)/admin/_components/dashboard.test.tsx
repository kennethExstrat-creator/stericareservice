// Markup of the dashboard's tiles, chart readout and breakdown cards: where
// the open inspections link, what each share says, and which rows link.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyCounts, summariseDashboard, type BreakdownRow, type ResultCounts } from "@/lib/admin/dashboard";
import { BreakdownCard } from "./breakdown-card";
import { ActivityTiles, OpenTiles } from "./dashboard-tiles";
import { readoutLines } from "./inspections-chart";

function text(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(element: ReactElement): string[] {
  return [...renderToStaticMarkup(element).matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
}

function counts(partial: Partial<ResultCounts>): ResultCounts {
  const merged = { ...emptyCounts(), ...partial };
  return { ...merged, total: merged.pass + merged.hold + merged.fail + merged.not_done };
}

describe("OpenTiles", () => {
  it("links each count to the list filtered to its status", () => {
    const element = <OpenTiles counts={{ submitted: 2, reopened: 0, draft: 10 }} />;
    expect(hrefs(element)).toEqual(["/inspections?status=submitted", "/inspections?status=reopened", "/inspections?status=draft"]);
    expect(text(element)).toContain("Awaiting Approval 2 Submitted, for you to approve or reopen.");
  });

  it("says so when the counts could not be read", () => {
    expect(text(<OpenTiles counts={null} />)).toContain("Could not be counted.");
  });
});

describe("ActivityTiles", () => {
  it("gives each result its share of the inspections with one, and compares with the days before", () => {
    const summary = summariseDashboard({
      rows: [
        { date: "2026-10-20", status: "approved", result: "pass", client: null, manufacturer: null, inspector: { id: "p", label: "P" } },
        { date: "2026-10-25", status: "approved", result: "pass", client: null, manufacturer: null, inspector: { id: "p", label: "P" } },
        { date: "2026-10-26", status: "submitted", result: "fail", client: null, manufacturer: null, inspector: { id: "p", label: "P" } },
        { date: "2026-10-27", status: "draft", result: null, client: null, manufacturer: null, inspector: { id: "p", label: "P" } },
      ],
      period: "7",
      today: "2026-10-27",
      firstDay: "2026-10-01",
    });
    const tiles = text(<ActivityTiles summary={summary} />);
    expect(tiles).toContain("Inspections 3 1 in the 7 days before");
    expect(tiles).toContain("Passed 1 50% of 2 with a result");
    expect(tiles).toContain("Failed 1 50% of 2 with a result");
    expect(tiles).toContain("Not Done 1 No result set yet");
  });
});

describe("the chart's readout", () => {
  it("names the busiest column until one is picked, then its results", () => {
    const column = { start: "2026-10-12", label: "Mon 12 Oct", tick: "12 Oct", counts: counts({ pass: 1, not_done: 2 }) };
    expect(readoutLines(column, true)).toEqual(["Busiest: Mon 12 Oct · 3 inspections", "1 Passed · 2 Not Done"]);
    expect(readoutLines(column, false)[0]).toBe("Mon 12 Oct · 3 inspections");
    expect(readoutLines(null, true)).toEqual(["No inspections in this period.", ""]);
  });
});

describe("BreakdownCard", () => {
  const rows: BreakdownRow[] = [
    ...["a", "b", "c", "d", "e", "f", "g"].map((id, index) => ({ id, label: `Client ${id.toUpperCase()}`, counts: counts({ pass: 8 - index }) })),
    { id: null, label: "No Client", counts: counts({ not_done: 1 }) },
  ];

  it("shows the busiest six, each linked, and counts the rest", () => {
    const element = (
      <BreakdownCard id="by-client" title="By Client" rows={rows} noun={{ one: "client", many: "clients" }} hrefFor={(id) => `/x?client=${id}`} />
    );
    expect(hrefs(element)).toEqual(["a", "b", "c", "d", "e", "f"].map((id) => `/x?client=${id}`));
    expect(text(element)).toContain("And 2 more clients.");
    expect(text(element)).toContain("Client A 8 8 inspections: 8 Passed");
  });

  it("links nothing without a destination, nor a row with none set", () => {
    expect(hrefs(<BreakdownCard id="i" title="By Inspector" rows={rows.slice(-1)} noun={{ one: "inspector", many: "inspectors" }} />)).toEqual([]);
    expect(
      hrefs(<BreakdownCard id="c" title="By Client" rows={rows.slice(-1)} noun={{ one: "client", many: "clients" }} hrefFor={(id) => id} />),
    ).toEqual([]);
  });

  it("says when the period has none", () => {
    expect(text(<BreakdownCard id="c" title="By Client" rows={[]} noun={{ one: "client", many: "clients" }} />)).toContain(
      "No inspections in this period.",
    );
  });
});
