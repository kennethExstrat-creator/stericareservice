import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInMalaysia } from "@/lib/inspections/create";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import { CLAUDE_MODELS } from "@/lib/schemas/ai-settings";
import {
  AI_USAGE_FEATURES,
  COST_PERIODS,
  DEFAULT_COST_PERIOD,
  type AiCostReport,
  type AiUsageFeature,
  type CostCurrency,
  type CostPeriod,
  type CostTrendPoint,
  type JobCost,
  type ModelCost,
} from "@/lib/schemas/ai-usage";
import type { Database } from "@/lib/supabase/database.types";

/*
 * The Steri-AI Cost view's report (docs/AI.md, "Steri-AI Cost"), from the
 * ai_usage rows lib/ai/usage.ts records. Read with the admin's own client
 * after requireAdmin: the three functions of migration 20261013120000 are
 * security invoker, so Row Level Security answers anyone else with no rows.
 * Each answer stays well under PostgREST's 1,000-row cap (jobs x models;
 * at most 92 days or the months since tracking began, x 4 jobs; 50
 * inspections), and buildAiCostReport puts them together. Days are Malaysia
 * days; Anthropic's Console counts UTC days.
 */

type Functions = Database["public"]["Functions"];
type SummaryRows = Functions["ai_usage_summary"]["Returns"];
type TrendRows = Functions["ai_usage_trend"]["Returns"];
type InspectionRows = Functions["ai_usage_by_inspection"]["Returns"];

export type CostReportResult = { ok: true; report: AiCostReport } | { ok: false; message: string };

const LOAD_FAILED = "The costs could not be loaded. Reload the page to try again.";
const MAX_INSPECTIONS = 50;
/** All Time spanning more than this many days is drawn by month. */
const MAX_DAY_BUCKETS = 92;
/** perMonthUsd needs at least this many days counted. */
const MIN_DAYS_FOR_MONTH_RATE = 7;
const DAY_MS = 86_400_000;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** ?period= as the cost view reads it: 7, 30, 90 or all; anything else is the default (30). */
export function parseCostPeriod(value: string | string[] | undefined): CostPeriod {
  const raw = first(value);
  return COST_PERIODS.find((period) => period === raw) ?? DEFAULT_COST_PERIOD;
}

/** ?currency= as the cost view reads it: MYR only once the price list has a rate, else USD. */
export function parseCostCurrency(value: string | string[] | undefined, prices: AiPriceList): CostCurrency {
  return first(value) === "myr" && prices.myrPerUsd !== null ? "myr" : "usd";
}

/** "2026-10-13" plus n days (n may be negative). */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (both YYYY-MM-DD). */
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The period's first Malaysia day (today and the n - 1 days before it), and
 * the moment it starts, for the functions' `since`. Both null for All Time.
 */
export function costPeriodStart(period: CostPeriod, now: Date = new Date()): { from: string | null; since: string | null } {
  if (period === "all") return { from: null, since: null };
  const from = addDays(todayInMalaysia(now), -(Number(period) - 1));
  return { from, since: `${from}T00:00:00+08:00` };
}

/** Malaysia day of a stored timestamp. */
function malaysiaDay(timestamp: string): string {
  return todayInMalaysia(new Date(timestamp));
}

/** The first day counted: the later of the period's first day and the first call's day, never after today. Null before any call. */
function firstCountedDay(from: string | null, trackingSince: string | null, today: string): string | null {
  if (!trackingSince) return null;
  const tracked = malaysiaDay(trackingSince);
  const start = from && from > tracked ? from : tracked;
  return start > today ? today : start;
}

function trendBucket(period: CostPeriod, trackingSince: string | null, now: Date): "day" | "month" {
  if (period !== "all" || !trackingSince) return "day";
  const today = todayInMalaysia(now);
  return daysFrom(malaysiaDay(trackingSince), today) + 1 > MAX_DAY_BUCKETS ? "month" : "day";
}

/**
 * The report for the period, read with the admin's own client (RLS limits
 * the rows to active admins). Never throws: a failed read comes back as a
 * message for the page.
 */
export async function loadAiCostReport(
  supabase: SupabaseClient<Database>,
  period: CostPeriod,
  options: { now?: Date; maxInspections?: number } = {},
): Promise<CostReportResult> {
  const now = options.now ?? new Date();
  try {
    const earliest = await supabase.from("ai_usage").select("created_at").order("created_at").limit(1).maybeSingle();
    if (earliest.error) {
      console.error("[ai cost] reading the first call failed", earliest.error.code, earliest.error.message);
      return { ok: false, message: LOAD_FAILED };
    }
    const trackingSince = earliest.data?.created_at ?? null;
    const { since } = costPeriodStart(period, now);
    const sinceArg = since ? { since } : {};
    const [summary, trend, inspections] = await Promise.all([
      supabase.rpc("ai_usage_summary", sinceArg),
      supabase.rpc("ai_usage_trend", { ...sinceArg, bucket: trendBucket(period, trackingSince, now) }),
      supabase.rpc("ai_usage_by_inspection", { ...sinceArg, max_rows: options.maxInspections ?? MAX_INSPECTIONS }),
    ]);
    const error = summary.error ?? trend.error ?? inspections.error;
    if (error) {
      console.error("[ai cost] reading the costs failed", error.code, error.message);
      return { ok: false, message: LOAD_FAILED };
    }
    return {
      ok: true,
      report: buildAiCostReport({
        period,
        now,
        trackingSince,
        summary: summary.data ?? [],
        trend: trend.data ?? [],
        inspections: inspections.data ?? [],
      }),
    };
  } catch (error) {
    console.error("[ai cost] reading the costs failed", error);
    return { ok: false, message: LOAD_FAILED };
  }
}

/** A number as PostgREST sends bigint and numeric; anything unreadable is 0. */
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Money summed from many rows, without float dust: six decimals, as stored. */
function usd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isFeature(value: string): value is AiUsageFeature {
  return (AI_USAGE_FEATURES as readonly string[]).includes(value);
}

function modelLabel(model: string): string {
  return CLAUDE_MODELS.find((entry) => entry.id === model)?.label ?? model;
}

/** Every bucket from `start` to `today`, inclusive: days, or the first day of each month. */
function bucketStarts(start: string, today: string, bucket: "day" | "month"): string[] {
  const starts: string[] = [];
  if (bucket === "day") {
    for (let day = start; day <= today; day = addDays(day, 1)) starts.push(day);
    return starts;
  }
  const [year, month] = start.split("-").map(Number);
  for (let index = 0; ; index++) {
    const first = new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0, 10);
    if (first > today) return starts;
    starts.push(first);
  }
}

/**
 * The report from the three functions' rows (pure, so it is unit tested):
 * the totals, each job and model, the trend with every bucket since the
 * later of the period's first day and the first call (untracked days never
 * read as zero cost), and the costliest inspections.
 */
export function buildAiCostReport(input: {
  period: CostPeriod;
  now: Date;
  trackingSince: string | null;
  summary: SummaryRows;
  trend: TrendRows;
  inspections: InspectionRows;
}): AiCostReport {
  const { period, now, trackingSince } = input;
  const to = todayInMalaysia(now);
  const { from } = costPeriodStart(period, now);
  const start = firstCountedDay(from, trackingSince, to);
  const daysCounted = start ? daysFrom(start, to) + 1 : 0;

  const costUsd = usd(input.summary.reduce((sum, row) => sum + num(row.cost_usd), 0));
  const unlinkedCostUsd = usd(input.summary.reduce((sum, row) => sum + num(row.unlinked_cost_usd), 0));
  const linkedCostUsd = usd(costUsd - unlinkedCostUsd);
  const inspections = num(input.inspections[0]?.inspection_count);
  const share = (value: number) => (costUsd > 0 ? value / costUsd : 0);

  const byJob: JobCost[] = AI_USAGE_FEATURES.map((feature) => {
    const rows = input.summary.filter((row) => row.feature === feature);
    const jobCost = usd(rows.reduce((sum, row) => sum + num(row.cost_usd), 0));
    const units = rows.reduce((sum, row) => sum + num(row.units), 0);
    return {
      feature,
      costUsd: jobCost,
      calls: rows.reduce((sum, row) => sum + num(row.calls), 0),
      failed: rows.reduce((sum, row) => sum + num(row.failed), 0),
      units,
      perUnitUsd: units > 0 ? jobCost / units : null,
      share: share(jobCost),
    };
  }).sort(
    (a, b) =>
      Number(b.calls > 0) - Number(a.calls > 0) ||
      b.costUsd - a.costUsd ||
      b.calls - a.calls ||
      AI_USAGE_FEATURES.indexOf(a.feature) - AI_USAGE_FEATURES.indexOf(b.feature),
  );

  const models = new Map<string, ModelCost>();
  for (const row of input.summary) {
    const entry = models.get(row.model) ?? {
      model: row.model,
      label: modelLabel(row.model),
      costUsd: 0,
      calls: 0,
      unpricedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      share: 0,
    };
    entry.costUsd = usd(entry.costUsd + num(row.cost_usd));
    entry.calls += num(row.calls);
    entry.unpricedCalls += num(row.unpriced);
    entry.inputTokens += num(row.input_tokens);
    entry.outputTokens += num(row.output_tokens);
    entry.cacheWriteTokens += num(row.cache_write_tokens);
    entry.cacheReadTokens += num(row.cache_read_tokens);
    models.set(row.model, entry);
  }
  const byModel = [...models.values()]
    .map((entry) => ({ ...entry, share: share(entry.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls || a.model.localeCompare(b.model));

  const bucket = trendBucket(period, trackingSince, now);
  const points = new Map<string, CostTrendPoint>(
    (start ? bucketStarts(bucket === "month" ? `${start.slice(0, 7)}-01` : start, to, bucket) : []).map((day) => [
      day,
      { start: day, costUsd: 0, calls: 0, byJob: {} },
    ]),
  );
  for (const row of input.trend) {
    const point = points.get(row.bucket_start);
    if (!point) continue;
    const cost = num(row.cost_usd);
    point.costUsd = usd(point.costUsd + cost);
    point.calls += num(row.calls);
    if (isFeature(row.feature)) point.byJob[row.feature] = usd((point.byJob[row.feature] ?? 0) + cost);
  }

  return {
    period,
    from,
    to,
    trackingSince,
    totals: {
      costUsd,
      calls: input.summary.reduce((sum, row) => sum + num(row.calls), 0),
      failed: input.summary.reduce((sum, row) => sum + num(row.failed), 0),
      unpricedCalls: input.summary.reduce((sum, row) => sum + num(row.unpriced), 0),
      inspections,
      linkedCostUsd,
      unlinkedCostUsd,
      perInspectionUsd: inspections > 0 ? linkedCostUsd / inspections : null,
      perMonthUsd: daysCounted >= MIN_DAYS_FOR_MONTH_RATE ? (costUsd / daysCounted) * 30 : null,
      daysCounted,
    },
    byJob,
    byModel,
    trend: { bucket, points: [...points.values()] },
    inspections: {
      rows: input.inspections.map((row) => ({
        inspectionId: row.inspection_id,
        refNo: row.ref_no,
        poNo: row.po_no || null,
        inspectionDate: row.inspection_date,
        status: row.status,
        documents: num(row.documents),
        mediaItems: num(row.media_items),
        reviews: num(row.reviews),
        calls: num(row.calls),
        costUsd: usd(num(row.cost_usd)),
      })),
      total: inspections,
    },
  };
}
