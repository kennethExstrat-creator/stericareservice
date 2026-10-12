// What Steri-AI costs (docs/AI.md, "Steri-AI Cost"): the jobs that call
// Claude, how a call ended, the cost view's periods and the report it shows.
// Client-safe: keys, labels and types. Each call is recorded server-side in
// ai_usage (lib/ai/usage.ts); lib/ai/cost-report.ts builds the report.
import type { InspectionStatus } from "./common";

/** The jobs that call Claude, as ai_usage.feature stores them. */
export const AI_USAGE_FEATURES = ["source_document_read", "second_opinion", "media_sort", "new_inspection_read"] as const;
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

/** ok: an answer. refused or cut_off: an answer that was billed but not usable. failed: no answer came back. */
export const AI_USAGE_OUTCOMES = ["ok", "refused", "cut_off", "failed"] as const;
export type AiUsageOutcome = (typeof AI_USAGE_OUTCOMES)[number];

/** Each job's name on screen, and what one item of it is (ai_usage.item_count counts them). */
export const AI_JOB: Readonly<Record<AiUsageFeature, { label: string; unit: string; units: string }>> = {
  source_document_read: { label: "Source Documents", unit: "document", units: "documents" },
  second_opinion: { label: "Second Opinion", unit: "review", units: "reviews" },
  media_sort: { label: "Auto-Sort", unit: "photo or video", units: "photos and videos" },
  new_inspection_read: { label: "New Inspection", unit: "document", units: "documents" },
};

/** The cost view's periods: the last 7, 30 or 90 Malaysia days, today included, or all time. */
export const COST_PERIODS = ["7", "30", "90", "all"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];
export const DEFAULT_COST_PERIOD: CostPeriod = "30";
export const COST_PERIOD_LABEL: Readonly<Record<CostPeriod, string>> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
  all: "All Time",
};

export type CostCurrency = "usd" | "myr";

export type CostTotals = {
  /** Priced calls. */
  costUsd: number;
  calls: number;
  failed: number;
  unpricedCalls: number;
  /** Inspections with a call in the period. */
  inspections: number;
  /** Calls linked to an inspection. */
  linkedCostUsd: number;
  /** New Inspection reads, and drafts deleted since. */
  unlinkedCostUsd: number;
  /** linkedCostUsd / inspections. */
  perInspectionUsd: number | null;
  /** costUsd / daysCounted * 30; null under 7 days counted. */
  perMonthUsd: number | null;
  /** The later of the period's first day and the first call's day, to today, inclusive. */
  daysCounted: number;
};

export type JobCost = {
  feature: AiUsageFeature;
  costUsd: number;
  calls: number;
  failed: number;
  /** Sum of item_count. */
  units: number;
  perUnitUsd: number | null;
  /** 0..1 of the period's cost. */
  share: number;
};

export type ModelCost = {
  model: string;
  /** CLAUDE_MODELS label, else the id. */
  label: string;
  costUsd: number;
  calls: number;
  unpricedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  share: number;
};

export type CostTrendPoint = {
  /** YYYY-MM-DD, Malaysia: the day, or the first day of the month. */
  start: string;
  costUsd: number;
  calls: number;
  byJob: Partial<Record<AiUsageFeature, number>>;
};

export type InspectionCost = {
  inspectionId: string;
  refNo: string;
  poNo: string | null;
  inspectionDate: string;
  status: InspectionStatus;
  documents: number;
  mediaItems: number;
  reviews: number;
  calls: number;
  costUsd: number;
};

export type AiCostReport = {
  period: CostPeriod;
  /** First day counted (Malaysia); null for All Time. */
  from: string | null;
  /** Today in Malaysia. */
  to: string;
  /** The first call ever recorded (ISO); null before any. */
  trackingSince: string | null;
  totals: CostTotals;
  /** All four jobs, costliest first, jobs with no calls last. */
  byJob: JobCost[];
  /** Costliest first. */
  byModel: ModelCost[];
  /** Every bucket from the later of from/trackingSince to today, zeros included. */
  trend: { bucket: "day" | "month"; points: CostTrendPoint[] };
  /** Costliest first, at most 50. */
  inspections: { rows: InspectionCost[]; total: number };
};
