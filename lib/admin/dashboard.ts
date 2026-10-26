import { STATUS_LABEL } from "@/lib/design/status";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";

/**
 * The admin dashboard (/admin; Kenneth, 27 October 2026: "the overview
 * should be a dashboard"): what a period's inspections add up to, by result,
 * by day or month, and by client, manufacturer and inspector. Pure, so the
 * page, the chart in the browser and the tests share it; the reads are in
 * dashboard-data.ts (server only).
 *
 * An inspection counts on its inspection date (a Malaysia calendar day), and
 * with the result the inspections list's Result column shows: the result the
 * inspector set, whatever the status, and Not Done until one is set.
 */

export const DASHBOARD_PERIODS = ["7", "30", "90", "all"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "30";

/** Steri-AI Cost's words for the same periods (COST_PERIOD_LABEL), so both pickers read alike. */
export const DASHBOARD_PERIOD_LABEL: Readonly<Record<DashboardPeriod, string>> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
  all: "All Time",
};

/** ADMIN_PATH in components/shell/nav.ts (server only, so not imported here). */
const DASHBOARD_PATH = "/admin";

/** All Time spanning more than this many days is drawn by month, as Steri-AI Cost's chart. */
const MAX_DAY_BUCKETS = 92;
const DAY_MS = 86_400_000;

export function isDashboardPeriod(value: string): value is DashboardPeriod {
  return (DASHBOARD_PERIODS as readonly string[]).includes(value);
}

/** ?period= as the dashboard reads it; anything else is the default. */
export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && isDashboardPeriod(raw) ? raw : DEFAULT_DASHBOARD_PERIOD;
}

/** The dashboard's address for a period: the default period leaves it out. */
export function dashboardHref(period: DashboardPeriod): string {
  return period === DEFAULT_DASHBOARD_PERIOD ? DASHBOARD_PATH : `${DASHBOARD_PATH}?period=${period}`;
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/** A result as the Result column shows it: Not Done until the inspector sets one. */
export type ResultKey = InspectionResult | "not_done";

/**
 * Bottom to top in the chart, left to right in its legend and the tiles. On
 * Hold sits between Passed and Failed so green never touches red: the pairs
 * that do touch stay apart for colour-blind readers.
 */
export const RESULT_ORDER: readonly ResultKey[] = ["pass", "hold", "fail", "not_done"];

/**
 * The marks of the chart and the breakdown bars: each result's solid colour,
 * Not Done a light slate, so the results set lead. Literal strings, so
 * Tailwind sees every class (as lib/design/status.ts).
 */
export const RESULT_FILL_CLASS: Readonly<Record<ResultKey, string>> = {
  pass: "bg-pass-solid",
  hold: "bg-hold-solid",
  fail: "bg-fail-solid",
  not_done: "bg-not-done-border",
};

export type ResultCounts = Record<ResultKey, number> & { total: number };

export function emptyCounts(): ResultCounts {
  return { total: 0, pass: 0, hold: 0, fail: 0, not_done: 0 };
}

function count(counts: ResultCounts, result: InspectionResult | null) {
  counts.total += 1;
  counts[result ?? "not_done"] += 1;
}

/** "1 inspection", "1,204 inspections". */
export function inspectionCount(total: number): string {
  return `${total.toLocaleString("en-US")} ${total === 1 ? "inspection" : "inspections"}`;
}

/** "2 Passed · 1 On Hold · 4 Not Done": the results with any inspections, in RESULT_ORDER. */
export function resultMix(counts: ResultCounts): string {
  return RESULT_ORDER.filter((key) => counts[key] > 0)
    .map((key) => `${counts[key].toLocaleString("en-US")} ${STATUS_LABEL[key]}`)
    .join(" · ");
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

type Named = { id: string; label: string };

/** One inspection as the dashboard reads it: no data, only what it counts by. */
export type DashboardRow = {
  /** The inspection date, YYYY-MM-DD. */
  date: string;
  status: InspectionStatus;
  result: InspectionResult | null;
  client: Named | null;
  manufacturer: Named | null;
  inspector: Named;
};

/** A client, manufacturer or inspector with its inspections; id null for those with none set ("No Client"). */
export type BreakdownRow = { id: string | null; label: string; counts: ResultCounts };

export type TrendBucket = "day" | "month";
export type TrendPoint = { start: string; counts: ResultCounts };

export type DashboardSummary = {
  period: DashboardPeriod;
  /** The first day counted: the later of the period's first day and the first inspection's. Null before any inspection. */
  since: string | null;
  totals: ResultCounts;
  /** Inspections in as many days before the period; null for All Time, or when none had been recorded by then. */
  previous: number | null;
  trend: { bucket: TrendBucket; points: TrendPoint[] };
  byClient: BreakdownRow[];
  byManufacturer: BreakdownRow[];
  byInspector: BreakdownRow[];
};

/** "2026-10-13" plus n days (n may be negative). */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (both YYYY-MM-DD). */
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The period's first day: today and the n - 1 days before it. Null for All Time. */
export function periodStart(period: DashboardPeriod, today: string): string | null {
  return period === "all" ? null : addDays(today, -(Number(period) - 1));
}

/**
 * The first day the dashboard reads, so the period before can be compared:
 * as many days again before the period's first. Null (everything) for All Time.
 */
export function readFrom(period: DashboardPeriod, today: string): string | null {
  const from = periodStart(period, today);
  return from === null ? null : addDays(from, -Number(period));
}

function bucketStarts(bucket: TrendBucket, since: string, end: string): string[] {
  const starts: string[] = [];
  if (bucket === "day") {
    for (let day = since; day <= end; day = addDays(day, 1)) starts.push(day);
    return starts;
  }
  let [year, month] = since.split("-").map(Number);
  const last = end.slice(0, 7);
  for (;;) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    if (start.slice(0, 7) > last) return starts;
    starts.push(start);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
}

/** Busiest first, then by name; inspections with none set ("No Client") count as one more row. */
function breakdown(rows: readonly DashboardRow[], pick: (row: DashboardRow) => Named | null, none: string): BreakdownRow[] {
  const groups = new Map<string, BreakdownRow>();
  for (const row of rows) {
    const named = pick(row);
    const key = named?.id ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { id: named?.id ?? null, label: named?.label ?? none, counts: emptyCounts() };
      groups.set(key, group);
    }
    count(group.counts, row.result);
  }
  return [...groups.values()].sort((a, b) => b.counts.total - a.counts.total || a.label.localeCompare(b.label));
}

/**
 * What the period's inspections add up to. `rows` are every inspection from
 * readFrom(period, today) on; `firstDay` is the first inspection's date of
 * all. Last 7, 30 and 90 days end today; All Time runs to the latest
 * inspection date if one lies ahead. The chart starts on the first day
 * counted, so days before the first inspection never read as quiet ones.
 */
export function summariseDashboard({
  rows,
  period,
  today,
  firstDay,
}: {
  rows: readonly DashboardRow[];
  period: DashboardPeriod;
  today: string;
  firstDay: string | null;
}): DashboardSummary {
  const from = periodStart(period, today);
  const end = period === "all" ? rows.reduce((latest, row) => (row.date > latest ? row.date : latest), today) : today;
  const inPeriod = rows.filter((row) => (from === null || row.date >= from) && row.date <= end);

  const totals = emptyCounts();
  for (const row of inPeriod) count(totals, row.result);

  let previous: number | null = null;
  if (from !== null && firstDay !== null && firstDay < from) {
    const before = addDays(from, -Number(period));
    previous = rows.filter((row) => row.date >= before && row.date < from).length;
  }

  const since = firstDay === null ? null : from !== null && from > firstDay ? from : firstDay;
  const bucket: TrendBucket =
    period === "all" && since !== null && daysFrom(since, end) + 1 > MAX_DAY_BUCKETS ? "month" : "day";
  const points: TrendPoint[] =
    since === null || since > end ? [] : bucketStarts(bucket, since, end).map((start) => ({ start, counts: emptyCounts() }));
  const index = new Map(points.map((point, position) => [point.start, position]));
  for (const row of inPeriod) {
    const position = index.get(bucket === "day" ? row.date : `${row.date.slice(0, 7)}-01`);
    if (position !== undefined) count(points[position].counts, row.result);
  }

  return {
    period,
    since,
    totals,
    previous,
    trend: { bucket, points },
    byClient: breakdown(inPeriod, (row) => row.client, "No Client"),
    byManufacturer: breakdown(inPeriod, (row) => row.manufacturer, "No Manufacturer"),
    byInspector: breakdown(inPeriod, (row) => row.inspector, "No Inspector"),
  };
}

/* ------------------------------------------------------------------ *
 * The chart's columns and axis
 * ------------------------------------------------------------------ */

export type ChartColumn = {
  /** The day (YYYY-MM-DD), or the month's first day. */
  start: string;
  /** "Mon 12 Oct", or "Oct 2026" by month: the readout and the table. */
  label: string;
  /** "12 Oct", or "Oct 2026": under the axis. */
  tick: string;
  counts: ResultCounts;
};

// Calendar days, formatted in UTC so they never shift (as formatInspectionDate).
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DAY_TICK = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** The trend as the chart draws it, its dates written out here, so server and browser show the same words. */
export function chartColumns(trend: DashboardSummary["trend"]): ChartColumn[] {
  return trend.points.map(({ start, counts }) => {
    const date = new Date(`${start}T00:00:00Z`);
    const byMonth = trend.bucket === "month";
    return {
      start,
      label: byMonth ? MONTH.format(date) : DAY_LABEL.format(date),
      tick: byMonth ? MONTH.format(date) : DAY_TICK.format(date),
      counts,
    };
  });
}

/**
 * The count axis's top: the smallest 2, 4, 6, 8 or 10 times a power of ten
 * at or above `value`, so the middle line is a whole number too; 2 when
 * there is less.
 */
export function countAxisMax(value: number): number {
  if (!(value > 2)) return 2;
  let scale = 1;
  while (scale * 10 < value) scale *= 10;
  return [2, 4, 6, 8, 10].map((step) => step * scale).find((top) => top >= value) ?? 10 * scale;
}

/** The column the readout starts on: the busiest, the latest of equals. -1 when no column has an inspection. */
export function busiestIndex(columns: readonly { counts: ResultCounts }[]): number {
  let best = -1;
  columns.forEach((column, position) => {
    if (column.counts.total > 0 && (best < 0 || column.counts.total >= columns[best].counts.total)) best = position;
  });
  return best;
}
