import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICES } from "@/lib/schemas/ai-prices";
import type { Database } from "@/lib/supabase/database.types";
import { buildAiCostReport, costPeriodStart, loadAiCostReport, parseCostCurrency, parseCostPeriod } from "./cost-report";

type Functions = Database["public"]["Functions"];
type SummaryRow = Functions["ai_usage_summary"]["Returns"][number];
type InspectionRow = Functions["ai_usage_by_inspection"]["Returns"][number];

/** 13:00 on 13 October 2026 in Malaysia. */
const NOW = new Date("2026-10-13T05:00:00Z");

function summaryRow(row: Partial<SummaryRow> & Pick<SummaryRow, "feature">): SummaryRow {
  return {
    model: "claude-opus-5-5",
    calls: 1,
    failed: 0,
    unpriced: 0,
    units: 1,
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    cost_usd: 0,
    unlinked_cost_usd: 0,
    ...row,
  };
}

const SUMMARY: SummaryRow[] = [
  summaryRow({ feature: "source_document_read", calls: 4, failed: 1, units: 4, input_tokens: 80_000, output_tokens: 9_000, cache_write_tokens: 30_000, cache_read_tokens: 90_000, cost_usd: 0.6 }),
  summaryRow({ feature: "second_opinion", input_tokens: 20_000, output_tokens: 6_000, cost_usd: 0.4 }),
  summaryRow({ feature: "second_opinion", model: "claude-opus-4-8", unpriced: 1, input_tokens: 9_000, output_tokens: 2_000, cost_usd: 0 }),
  summaryRow({ feature: "new_inspection_read", calls: 2, units: 2, input_tokens: 10_000, output_tokens: 1_000, cost_usd: 0.1, unlinked_cost_usd: 0.1 }),
];

const INSPECTIONS: InspectionRow[] = [
  {
    inspection_id: "00000000-0000-4000-8000-000000000001",
    ref_no: "INS-2026-0001",
    po_no: "PO-1",
    inspection_date: "2026-10-12",
    status: "submitted",
    documents: 4,
    media_items: 0,
    reviews: 2,
    calls: 6,
    cost_usd: 0.9,
    inspection_count: 2,
  },
  {
    inspection_id: "00000000-0000-4000-8000-000000000002",
    ref_no: "INS-2026-0002",
    po_no: "",
    inspection_date: "2026-10-13",
    status: "draft",
    documents: 0,
    media_items: 0,
    reviews: 0,
    calls: 0,
    cost_usd: 0.1,
    inspection_count: 2,
  },
];

describe("the cost view's address", () => {
  it("reads the period and the currency, defaults for anything else", () => {
    expect(parseCostPeriod("90")).toBe("90");
    expect(parseCostPeriod(["all", "7"])).toBe("all");
    expect(parseCostPeriod("365")).toBe("30");
    expect(parseCostPeriod(undefined)).toBe("30");
    expect(parseCostCurrency("myr", DEFAULT_AI_PRICES)).toBe("usd");
    expect(parseCostCurrency("myr", { ...DEFAULT_AI_PRICES, myrPerUsd: 4.72, myrRateOn: "2026-10-01" })).toBe("myr");
    expect(parseCostCurrency("eur", { ...DEFAULT_AI_PRICES, myrPerUsd: 4.72, myrRateOn: "2026-10-01" })).toBe("usd");
  });

  it("starts a period at Malaysia midnight, today included", () => {
    expect(costPeriodStart("7", NOW)).toEqual({ from: "2026-10-07", since: "2026-10-07T00:00:00+08:00" });
    expect(costPeriodStart("30", NOW)).toEqual({ from: "2026-09-14", since: "2026-09-14T00:00:00+08:00" });
    // 23:30 UTC on 12 October is already the 13th in Malaysia.
    expect(costPeriodStart("7", new Date("2026-10-12T23:30:00Z")).from).toBe("2026-10-07");
    expect(costPeriodStart("all", NOW)).toEqual({ from: null, since: null });
  });
});

describe("buildAiCostReport", () => {
  it("adds up the period, each job and each model, costliest first and jobs with no calls last", () => {
    const report = buildAiCostReport({
      period: "7",
      now: NOW,
      trackingSince: "2026-10-10T03:00:00+00:00",
      summary: SUMMARY,
      trend: [],
      inspections: INSPECTIONS,
    });

    expect(report).toMatchObject({ period: "7", from: "2026-10-07", to: "2026-10-13", trackingSince: "2026-10-10T03:00:00+00:00" });
    expect(report.totals).toEqual({
      costUsd: 1.1,
      calls: 8,
      failed: 1,
      unpricedCalls: 1,
      inspections: 2,
      linkedCostUsd: 1,
      unlinkedCostUsd: 0.1,
      perInspectionUsd: 0.5,
      // Counted since the first call on 10 October: 4 days, too few for a monthly rate.
      perMonthUsd: null,
      daysCounted: 4,
    });

    expect(report.byJob.map((job) => [job.feature, job.costUsd, job.calls, job.units, job.perUnitUsd])).toEqual([
      ["source_document_read", 0.6, 4, 4, 0.15],
      ["second_opinion", 0.4, 2, 2, 0.2],
      ["new_inspection_read", 0.1, 2, 2, 0.05],
      ["media_sort", 0, 0, 0, null],
    ]);
    expect(report.byJob[0].failed).toBe(1);
    expect(report.byJob[0].share).toBeCloseTo(0.6 / 1.1);
    expect(report.byJob[3].share).toBe(0);

    expect(report.byModel).toEqual([
      {
        model: "claude-opus-5-5",
        label: "Claude Opus 5.5",
        costUsd: 1.1,
        calls: 7,
        unpricedCalls: 0,
        inputTokens: 110_000,
        outputTokens: 16_000,
        cacheWriteTokens: 30_000,
        cacheReadTokens: 90_000,
        share: 1,
      },
      {
        model: "claude-opus-4-8",
        label: "claude-opus-4-8",
        costUsd: 0,
        calls: 1,
        unpricedCalls: 1,
        inputTokens: 9_000,
        outputTokens: 2_000,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        share: 0,
      },
    ]);

    expect(report.inspections).toEqual({
      total: 2,
      rows: [
        {
          inspectionId: "00000000-0000-4000-8000-000000000001",
          refNo: "INS-2026-0001",
          poNo: "PO-1",
          inspectionDate: "2026-10-12",
          status: "submitted",
          documents: 4,
          mediaItems: 0,
          reviews: 2,
          calls: 6,
          costUsd: 0.9,
        },
        expect.objectContaining({ refNo: "INS-2026-0002", poNo: null, costUsd: 0.1 }),
      ],
    });
  });

  it("fills every day since the later of the period's start and the first call, zeros included", () => {
    const report = buildAiCostReport({
      period: "7",
      now: NOW,
      trackingSince: "2026-10-10T03:00:00+00:00",
      summary: SUMMARY,
      trend: [
        { bucket_start: "2026-10-10", feature: "source_document_read", calls: 2, cost_usd: 0.3 },
        { bucket_start: "2026-10-12", feature: "source_document_read", calls: 2, cost_usd: 0.3 },
        { bucket_start: "2026-10-12", feature: "second_opinion", calls: 2, cost_usd: 0.4 },
        { bucket_start: "2026-10-13", feature: "new_inspection_read", calls: 2, cost_usd: 0.1 },
      ],
      inspections: INSPECTIONS,
    });
    expect(report.trend).toEqual({
      bucket: "day",
      points: [
        { start: "2026-10-10", costUsd: 0.3, calls: 2, byJob: { source_document_read: 0.3 } },
        { start: "2026-10-11", costUsd: 0, calls: 0, byJob: {} },
        { start: "2026-10-12", costUsd: 0.7, calls: 4, byJob: { source_document_read: 0.3, second_opinion: 0.4 } },
        { start: "2026-10-13", costUsd: 0.1, calls: 2, byJob: { new_inspection_read: 0.1 } },
      ],
    });

    // Tracked for longer than the period: all 30 days, and a monthly rate.
    const month = buildAiCostReport({ period: "30", now: NOW, trackingSince: "2026-09-01T00:00:00Z", summary: SUMMARY, trend: [], inspections: [] });
    expect(month.trend.points).toHaveLength(30);
    expect(month.trend.points[0].start).toBe("2026-09-14");
    expect(month.totals.daysCounted).toBe(30);
    expect(month.totals.perMonthUsd).toBeCloseTo(1.1);
    expect(month.totals).toMatchObject({ inspections: 0, perInspectionUsd: null });

    // 12 days of use (2 to 13 October) scaled to 30.
    const twelve = buildAiCostReport({ period: "30", now: NOW, trackingSince: "2026-10-01T16:30:00Z", summary: SUMMARY, trend: [], inspections: [] });
    expect(twelve.totals.daysCounted).toBe(12);
    expect(twelve.totals.perMonthUsd).toBeCloseTo((1.1 / 12) * 30);
  });

  it("draws All Time by month once it spans more than 92 days, by day before", () => {
    const months = buildAiCostReport({
      period: "all",
      now: NOW,
      trackingSince: "2026-05-20T00:00:00Z",
      summary: SUMMARY,
      trend: [
        { bucket_start: "2026-05-01", feature: "media_sort", calls: 3, cost_usd: 0.2 },
        { bucket_start: "2026-10-01", feature: "source_document_read", calls: 1, cost_usd: 0.1 },
      ],
      inspections: [],
    });
    expect(months.from).toBeNull();
    expect(months.trend.bucket).toBe("month");
    expect(months.trend.points).toEqual([
      { start: "2026-05-01", costUsd: 0.2, calls: 3, byJob: { media_sort: 0.2 } },
      { start: "2026-06-01", costUsd: 0, calls: 0, byJob: {} },
      { start: "2026-07-01", costUsd: 0, calls: 0, byJob: {} },
      { start: "2026-08-01", costUsd: 0, calls: 0, byJob: {} },
      { start: "2026-09-01", costUsd: 0, calls: 0, byJob: {} },
      { start: "2026-10-01", costUsd: 0.1, calls: 1, byJob: { source_document_read: 0.1 } },
    ]);
    expect(months.totals.daysCounted).toBe(147);
    expect(months.totals.perMonthUsd).toBeCloseTo((1.1 / 147) * 30);

    const days = buildAiCostReport({ period: "all", now: NOW, trackingSince: "2026-07-14T00:00:00Z", summary: [], trend: [], inspections: [] });
    expect(days.trend.bucket).toBe("day");
    expect(days.trend.points).toHaveLength(92);
  });

  it("shows nothing as tracked before the first call", () => {
    const report = buildAiCostReport({ period: "30", now: NOW, trackingSince: null, summary: [], trend: [], inspections: [] });
    expect(report.trend.points).toEqual([]);
    expect(report.totals).toEqual({
      costUsd: 0,
      calls: 0,
      failed: 0,
      unpricedCalls: 0,
      inspections: 0,
      linkedCostUsd: 0,
      unlinkedCostUsd: 0,
      perInspectionUsd: null,
      perMonthUsd: null,
      daysCounted: 0,
    });
    expect(report.byJob.map((job) => job.feature)).toEqual(["source_document_read", "second_opinion", "media_sort", "new_inspection_read"]);
  });
});

describe("loadAiCostReport", () => {
  function fakeClient(firstCall: string | null, failing?: string) {
    const rpc = vi.fn(async (name: string) => ({
      data: [],
      error: name === failing ? { code: "42883", message: `function ${name} does not exist` } : null,
    }));
    const maybeSingle = vi.fn(async () => ({ data: firstCall ? { created_at: firstCall } : null, error: null }));
    const chain = { select: () => chain, order: () => chain, limit: () => ({ maybeSingle }) };
    return { client: { from: vi.fn(() => chain), rpc } as never, rpc };
  }

  it("asks for the period since its first Malaysia day, by day", async () => {
    const { client, rpc } = fakeClient("2026-10-10T03:00:00+00:00");
    const result = await loadAiCostReport(client, "7", { now: NOW });
    expect(result).toMatchObject({ ok: true, report: { period: "7", trackingSince: "2026-10-10T03:00:00+00:00" } });
    const since = "2026-10-07T00:00:00+08:00";
    expect(rpc.mock.calls).toEqual([
      ["ai_usage_summary", { since }],
      ["ai_usage_trend", { since, bucket: "day" }],
      ["ai_usage_by_inspection", { since, max_rows: 50 }],
    ]);
  });

  it("asks for All Time without a start, by month once it spans more than 92 days", async () => {
    const { client, rpc } = fakeClient("2026-05-20T00:00:00Z");
    await loadAiCostReport(client, "all", { now: NOW, maxInspections: 20 });
    expect(rpc.mock.calls).toEqual([
      ["ai_usage_summary", {}],
      ["ai_usage_trend", { bucket: "month" }],
      ["ai_usage_by_inspection", { max_rows: 20 }],
    ]);
  });

  it("answers a message for the page when a read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(null, "ai_usage_trend");
    expect(await loadAiCostReport(client, "30", { now: NOW })).toEqual({
      ok: false,
      message: "The costs could not be loaded. Reload the page to try again.",
    });
  });
});
