// The admin dashboard's sums: which inspections a period counts, the period
// before it, the chart's days or months, the breakdowns, and the axis.
import { describe, expect, it } from "vitest";
import {
  busiestIndex,
  chartColumns,
  countAxisMax,
  dashboardHref,
  emptyCounts,
  parseDashboardPeriod,
  readFrom,
  resultMix,
  summariseDashboard,
  type DashboardRow,
} from "./dashboard";

const TODAY = "2026-10-27";

const CLIENT = { id: "c1", label: "Client One" };
const OTHER_CLIENT = { id: "c2", label: "Client Two" };
const MAKER = { id: "m1", label: "Maker One · Factory 4" };
const INSPECTOR = { id: "p1", label: "Test Inspector" };
const LEAD = { id: "p2", label: "Lead Inspector" };

function row(date: string, result: DashboardRow["result"], extra: Partial<DashboardRow> = {}): DashboardRow {
  return { date, status: "draft", result, client: CLIENT, manufacturer: MAKER, inspector: INSPECTOR, ...extra };
}

describe("the period", () => {
  it("reads ?period=, falling back to the last 30 days", () => {
    expect(parseDashboardPeriod("7")).toBe("7");
    expect(parseDashboardPeriod(["all", "7"])).toBe("all");
    expect(parseDashboardPeriod("365")).toBe("30");
    expect(parseDashboardPeriod(undefined)).toBe("30");
  });

  it("leaves the default out of the address", () => {
    expect(dashboardHref("30")).toBe("/admin");
    expect(dashboardHref("90")).toBe("/admin?period=90");
  });

  it("reads as many days again before the period, to compare; everything for All Time", () => {
    expect(readFrom("7", TODAY)).toBe("2026-10-14");
    expect(readFrom("30", TODAY)).toBe("2026-08-29");
    expect(readFrom("all", TODAY)).toBeNull();
  });
});

describe("summariseDashboard", () => {
  const rows: DashboardRow[] = [
    row("2026-10-08", "pass"),
    row("2026-10-08", null, { client: null }),
    row("2026-10-20", "fail", { client: OTHER_CLIENT, inspector: LEAD }),
    row("2026-10-21", "hold", { client: OTHER_CLIENT }),
    row("2026-10-27", null),
  ];

  it("counts the period's inspections by result, Not Done until one is set", () => {
    const summary = summariseDashboard({ rows, period: "7", today: TODAY, firstDay: "2026-10-08" });
    expect(summary.totals).toEqual({ total: 2, pass: 0, hold: 1, fail: 0, not_done: 1 });
    expect(summary.since).toBe("2026-10-21");
    // The 7 days before: 14 to 20 October.
    expect(summary.previous).toBe(1);
  });

  it("starts on the first inspection, compares nothing from before it, and charts one column a day", () => {
    const summary = summariseDashboard({ rows, period: "30", today: TODAY, firstDay: "2026-10-08" });
    expect(summary.since).toBe("2026-10-08");
    expect(summary.previous).toBeNull();
    expect(summary.trend.bucket).toBe("day");
    expect(summary.trend.points).toHaveLength(20);
    expect(summary.trend.points[0]).toEqual({ start: "2026-10-08", counts: { total: 2, pass: 1, hold: 0, fail: 0, not_done: 1 } });
    expect(summary.trend.points.at(-1)?.start).toBe(TODAY);
  });

  it("breaks the period down busiest first, inspections with no client as their own row", () => {
    const summary = summariseDashboard({ rows, period: "30", today: TODAY, firstDay: "2026-10-08" });
    expect(summary.byClient.map((entry) => [entry.label, entry.counts.total])).toEqual([
      ["Client One", 2],
      ["Client Two", 2],
      ["No Client", 1],
    ]);
    expect(summary.byClient[2].id).toBeNull();
    expect(summary.byManufacturer).toHaveLength(1);
    expect(summary.byInspector.map((entry) => entry.label)).toEqual(["Test Inspector", "Lead Inspector"]);
  });

  it("goes by month for All Time over 92 days, and runs to an inspection dated ahead", () => {
    const summary = summariseDashboard({
      rows: [row("2026-06-30", "pass"), row("2026-10-27", "fail"), row("2026-11-02", null)],
      period: "all",
      today: TODAY,
      firstDay: "2026-06-30",
    });
    expect(summary.previous).toBeNull();
    expect(summary.totals.total).toBe(3);
    expect(summary.trend.bucket).toBe("month");
    expect(summary.trend.points.map((point) => [point.start, point.counts.total])).toEqual([
      ["2026-06-01", 1],
      ["2026-07-01", 0],
      ["2026-08-01", 0],
      ["2026-09-01", 0],
      ["2026-10-01", 1],
      ["2026-11-01", 1],
    ]);
  });

  it("knows nothing before the first inspection", () => {
    const summary = summariseDashboard({ rows: [], period: "30", today: TODAY, firstDay: null });
    expect(summary.since).toBeNull();
    expect(summary.trend.points).toEqual([]);
    expect(summary.totals).toEqual(emptyCounts());
  });
});

describe("the chart", () => {
  it("tops the axis at 2, 4, 6, 8 or 10 times a power of ten, so the middle line is whole", () => {
    expect([0, 1, 2, 3, 5, 7, 10, 11, 25, 45, 100, 101].map(countAxisMax)).toEqual([
      2, 2, 2, 4, 6, 8, 10, 20, 40, 60, 100, 200,
    ]);
  });

  it("starts the readout on the busiest column, the latest of equals", () => {
    const counts = (total: number) => ({ ...emptyCounts(), total, not_done: total });
    expect(busiestIndex([counts(0), counts(2), counts(1), counts(2)].map((c) => ({ counts: c })))).toBe(3);
    expect(busiestIndex([{ counts: emptyCounts() }])).toBe(-1);
  });

  it("writes the days and months out the same way everywhere", () => {
    const counts = emptyCounts();
    expect(chartColumns({ bucket: "day", points: [{ start: "2026-10-12", counts }] })[0]).toMatchObject({
      label: "Mon 12 Oct",
      tick: "12 Oct",
    });
    expect(chartColumns({ bucket: "month", points: [{ start: "2026-10-01", counts }] })[0]).toMatchObject({
      label: "Oct 2026",
      tick: "Oct 2026",
    });
  });

  it("names the results with any inspections, in the chart's order", () => {
    expect(resultMix({ total: 7, pass: 2, hold: 0, fail: 1, not_done: 4 })).toBe("2 Passed · 1 Failed · 4 Not Done");
    expect(resultMix(emptyCounts())).toBe("");
  });
});
