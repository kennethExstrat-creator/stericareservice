// Cost per Day: the axis, the day the readout starts on (the highest), the
// keys that move it, and the hidden table that carries every day. The
// browser part (pointer and keys on the plot) is e2e's; these are the rules
// it follows.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { axisPlaces, CostTrendChart, highestIndex, moveIndex, niceMax, readoutLines, type TrendBar } from "./cost-trend-chart";
import { USD, type Money } from "./money";

function bar(start: string, label: string, costUsd: number, calls: number, byJob: TrendBar["byJob"] = {}): TrendBar {
  return { start, label, tick: label.slice(4), costUsd, calls, byJob };
}

const WEEK: TrendBar[] = [
  bar("2026-10-06", "Tue 6 Oct", 0.2, 5, { source_document_read: 0.2 }),
  bar("2026-10-07", "Wed 7 Oct", 0, 0),
  bar("2026-10-08", "Thu 8 Oct", 0.84, 23, { second_opinion: 0.3, media_sort: 0.04, source_document_read: 0.5 }),
  bar("2026-10-09", "Fri 9 Oct", 0.1, 2, { new_inspection_read: 0.1 }),
  bar("2026-10-10", "Sat 10 Oct", 0, 0),
  bar("2026-10-11", "Sun 11 Oct", 0, 0),
  bar("2026-10-12", "Mon 12 Oct", 0.3, 4, { second_opinion: 0.3 }),
];

describe("the axis", () => {
  it("tops out at 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.84)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.2)).toBe(2);
    expect(niceMax(2.1)).toBe(2.5);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(6)).toBe(10);
    expect(niceMax(12.8)).toBe(20);
    expect(niceMax(0.021)).toBe(0.025);
    expect(niceMax(0.03)).toBe(0.05);
  });

  it("labels the middle line exactly, with at least 2 decimals below 10", () => {
    expect(axisPlaces(1)).toBe(2); // $0.50
    expect(axisPlaces(2.5)).toBe(2); // $1.25
    expect(axisPlaces(0.025)).toBe(4); // $0.0125
    expect(axisPlaces(20)).toBe(0); // $10
    expect(axisPlaces(25)).toBe(2); // $12.50
  });
});

describe("the readout", () => {
  it("starts on the highest day, with its jobs costliest first", () => {
    const index = highestIndex(WEEK);
    expect(index).toBe(2);
    expect(readoutLines(WEEK[index], USD, true)).toEqual([
      "Highest: Thu 8 Oct · $0.84 · 23 calls",
      "Source Documents $0.50 · Second Opinion $0.30 · Auto-Sort $0.04",
    ]);
  });

  it("drops “Highest:” once a day is picked, and counts one call as one", () => {
    expect(readoutLines(WEEK[3], USD, false)).toEqual(["Fri 9 Oct · $0.10 · 2 calls", "New Inspection $0.10"]);
    expect(readoutLines(bar("2026-10-13", "Tue 13 Oct", 0.05, 1, { media_sort: 0.05 }), USD, false)[0]).toBe("Tue 13 Oct · $0.05 · 1 call");
    expect(readoutLines(WEEK[1], USD, false)).toEqual(["Wed 7 Oct · $0.00 · 0 calls", ""]);
  });

  it("speaks the chosen currency", () => {
    const myr: Money = { currency: "myr", myrPerUsd: 4.72 };
    expect(readoutLines(WEEK[6], myr, false)).toEqual(["Mon 12 Oct · RM 1.42 · 4 calls", "Second Opinion RM 1.42"]);
  });

  it("takes the busier, then the later of equal days, and says so when no day has a call", () => {
    expect(highestIndex([bar("2026-10-01", "Thu 1 Oct", 0.5, 2), bar("2026-10-02", "Fri 2 Oct", 0.5, 9), bar("2026-10-03", "Sat 3 Oct", 0.5, 9)])).toBe(2);
    // Calls with no price still count as a day with calls.
    expect(highestIndex([bar("2026-10-01", "Thu 1 Oct", 0, 0), bar("2026-10-02", "Fri 2 Oct", 0, 2)])).toBe(1);
    expect(highestIndex([bar("2026-10-01", "Thu 1 Oct", 0, 0)])).toBe(-1);
    expect(readoutLines(null, USD, true)).toEqual(["No calls in this period.", ""]);
  });

  it("moves with the arrow keys, Home and End, and stops at the ends", () => {
    expect(moveIndex("ArrowLeft", 2, 7)).toBe(1);
    expect(moveIndex("ArrowRight", 2, 7)).toBe(3);
    expect(moveIndex("ArrowRight", 6, 7)).toBe(6);
    expect(moveIndex("ArrowLeft", 0, 7)).toBe(0);
    expect(moveIndex("Home", 4, 7)).toBe(0);
    expect(moveIndex("End", 1, 7)).toBe(6);
    // Nothing chosen yet (a period with no calls): the first key starts at an end.
    expect(moveIndex("ArrowRight", null, 7)).toBe(0);
    expect(moveIndex("ArrowLeft", null, 7)).toBe(6);
    expect(moveIndex("ArrowUp", 2, 7)).toBeNull();
    expect(moveIndex("ArrowRight", null, 0)).toBeNull();
  });
});

describe("the card", () => {
  it("reads out the highest day first, the plot one named tab stop, every day in the hidden table", () => {
    const html = renderToStaticMarkup(<CostTrendChart bucket="day" bars={WEEK} money={USD} />);
    expect(html).toContain(">Cost per Day</h2>");
    expect(html).toContain("Highest: Thu 8 Oct · $0.84 · 23 calls");
    expect(html).toMatch(/role="group" tabindex="0" aria-label="Cost per day"/);
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/data-chosen="true"/g)).toHaveLength(1);
    const table = html.slice(html.indexOf('<table class="sr-only">'));
    expect(table).toContain("<caption>Cost per day</caption>");
    expect(table).toContain('<th scope="col">Day</th><th scope="col">Cost</th><th scope="col">Calls</th>');
    for (const day of WEEK) expect(table).toContain(`<th scope="row">${day.label}</th>`);
    expect(table).toContain('<th scope="row">Wed 7 Oct</th><td>$0.00</td><td>0</td>');
    // The axis: 0, half and the top, in dollars.
    expect(html).toMatch(/<span>\$1\.00<\/span><span>\$0\.50<\/span><span>\$0\.00<\/span>/);
  });

  it("is Cost per Month by month, and says when the period has no calls", () => {
    const months = [bar("2026-09-01", "Sept 2026", 0, 0), bar("2026-10-01", "Oct 2026", 0, 0)];
    const html = renderToStaticMarkup(<CostTrendChart bucket="month" bars={months} money={USD} />);
    expect(html).toContain(">Cost per Month</h2>");
    expect(html).toContain("<caption>Cost per month</caption>");
    expect(html).toContain('<th scope="col">Month</th>');
    expect(html).toContain("No calls in this period.");
    expect(html).not.toContain("data-chosen");
  });
});
