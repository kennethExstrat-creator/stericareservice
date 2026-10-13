// Steri-AI Settings > Steri-AI Cost (/admin/ai?view=cost; docs/AI.md,
// "Steri-AI Cost"): what Steri-AI costs to run, estimated from the tokens of
// every Claude call the app records (ai_usage), priced with the list in force
// when the call was made. Top to bottom: the filter row, three headline
// numbers, cost per day, cost by job and by model, the costliest
// inspections, and the price list. Every amount is in the currency the
// address names (?currency=, ringgit by default; the RM | USD switch sets
// it): costs are kept in US dollars and converted at the rate in use
// (lib/ai/myr-rate.ts). The view loads only its own data, with the admin's
// own client: Row Level Security gives anyone else no rows.
import { CoinsIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { loadAiCostReport, type CostReportResult } from "@/lib/ai/cost-report";
import { latestBnmRate, pickMyrRate } from "@/lib/ai/myr-rate";
import { loadAiPrices } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/auth/session";
import { todayInMalaysia } from "@/lib/inspections/create";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import type { AiCostReport, CostCurrency, CostPeriod, MyrRate } from "@/lib/schemas/ai-usage";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CostByJob, CostByModel } from "./cost-breakdown";
import { CostFilters } from "./cost-filters";
import { CostByInspection } from "./cost-inspections";
import { CostTiles } from "./cost-tiles";
import { CostTrendChart, type TrendBar } from "./cost-trend-chart";
import { USD, type Money } from "./money";
import { PriceList } from "./price-list";
import { PriceNotes, PriceTable } from "./price-table";

const LOAD_FAILED = "The costs could not be loaded. Reload the page to try again.";

// Calendar days, formatted in UTC so they never shift (as formatInspectionDate).
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DAY_TICK = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * The chart's columns, their dates written here on the server ("Mon 12 Oct",
 * "12 Oct"; "Sept 2026" by month), so the browser draws the same words.
 */
function trendBars(trend: AiCostReport["trend"]): TrendBar[] {
  return trend.points.map((point) => {
    const date = utcDate(point.start);
    const month = trend.bucket === "month";
    return {
      start: point.start,
      label: month ? MONTH.format(date) : DAY_LABEL.format(date),
      tick: month ? MONTH.format(date) : DAY_TICK.format(date),
      costUsd: point.costUsd,
      calls: point.calls,
      byJob: point.byJob,
    };
  });
}

/** "13 Oct 2026" when the period starts before the first recorded call (always for All Time), else null. */
function countedSince(report: AiCostReport): string | null {
  if (!report.trackingSince) return null;
  const first = todayInMalaysia(new Date(report.trackingSince));
  return report.from === null || report.from < first ? formatInspectionDate(first) : null;
}

async function loadReport(period: CostPeriod): Promise<CostReportResult> {
  try {
    return await loadAiCostReport(await createClient(), period);
  } catch (error) {
    console.error("[ai cost] reading the costs failed", error);
    return { ok: false, message: LOAD_FAILED };
  }
}

export async function CostView({ period, currency }: { period: CostPeriod; currency: CostCurrency }) {
  // The page has checked already; the check is cached for the request.
  await requireAdmin();
  // BNM's rate never throws; Next's cache answers, and BNM is asked about once a day (lib/ai/myr-rate.ts).
  const [prices, result, bnmRate] = await Promise.all([loadAiPrices(), loadReport(period), latestBnmRate()]);
  return (
    <CostViewBody
      period={period}
      currency={currency}
      rate={pickMyrRate(prices, bnmRate)}
      result={result}
      prices={prices}
      canSave={isAdminClientConfigured()}
    />
  );
}

function ErrorAlert({ children }: { children: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden />
      <AlertDescription className="text-destructive">{children}</AlertDescription>
    </Alert>
  );
}

function NothingYet() {
  return (
    <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12 md:py-16" data-testid="cost-empty">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
          <CoinsIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-lg font-bold text-foreground">No Steri-AI Costs Yet</h2>
        </EmptyTitle>
        <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
          Every document Steri-AI reads, every Auto-Sort and every second opinion is counted from now on.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function Dashboard({
  report,
  period,
  money,
  rate,
  prices,
}: {
  report: AiCostReport;
  period: CostPeriod;
  money: Money;
  rate: MyrRate;
  prices: AiPriceList;
}) {
  return (
    <>
      <CostFilters period={period} currency={money.currency} rate={rate} countedSince={countedSince(report)} />
      <CostTiles totals={report.totals} money={money} />
      <CostTrendChart key={`${period}:${money.currency}`} bucket={report.trend.bucket} bars={trendBars(report.trend)} money={money} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CostByJob jobs={report.byJob} money={money} />
        <CostByModel models={report.byModel} money={money} prices={prices} />
      </div>
      <CostByInspection inspections={report.inspections} unlinkedCostUsd={report.totals.unlinkedCostUsd} money={money} />
    </>
  );
}

/** The view from what was loaded: the page renders it through CostView. */
function CostViewBody({
  period,
  currency,
  rate,
  result,
  prices,
  canSave,
}: {
  period: CostPeriod;
  /** The address's currency: ringgit unless it says US dollars. */
  currency: CostCurrency;
  /** The rate ringgit is worked out at (pickMyrRate). */
  rate: MyrRate;
  result: CostReportResult;
  prices: AiPriceList;
  /** The server has SUPABASE_SECRET_KEY: calls are recorded and the prices can be saved. */
  canSave: boolean;
}) {
  const money: Money = { currency, myrPerUsd: rate.myrPerUsd };
  // Ringgit shows only with the switch and the line naming its rate: before the first call, and when
  // the costs could not be loaded, the price list stays in dollars alone.
  const dashboard = result.ok && result.report.trackingSince !== null ? result.report : null;
  return (
    <div data-testid="ai-cost" data-period={period} data-currency={currency} className="flex min-w-0 flex-col gap-6">
      {!canSave && <ErrorAlert>The server needs SUPABASE_SECRET_KEY to record Steri-AI&apos;s costs.</ErrorAlert>}
      {dashboard ? (
        <Dashboard report={dashboard} period={period} money={money} rate={rate} prices={prices} />
      ) : result.ok ? (
        <NothingYet />
      ) : (
        <ErrorAlert>{result.message}</ErrorAlert>
      )}
      <PriceList
        prices={prices}
        canEdit={canSave}
        table={<PriceTable prices={prices} money={dashboard ? money : USD} />}
        notes={<PriceNotes prices={prices} />}
      />
    </div>
  );
}
