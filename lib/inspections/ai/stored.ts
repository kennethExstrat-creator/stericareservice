import { z } from "zod";
import { AiFindingSchema, AiQuestionSchema, type AiFinding, type AiQuestion } from "@/lib/schemas/ai-review";
import { InspectionResultSchema, type InspectionResult } from "@/lib/schemas/common";
import type { AiReviewProvider } from "@/lib/ai/types";
import type { Tables } from "@/lib/supabase/database.types";

/* ------------------------------------------------------------------ *
 * ai_reviews rows (BUILD_SPEC 9.2): one per request, keyed to the
 * inspection version it reviewed (inspection_updated_at). Pending, then
 * done or failed. Findings and questions are stored as the reviewer
 * returned them (AiReviewSchema); a failed review keeps its reason in
 * `summary`, the only text column the table has for it.
 * ------------------------------------------------------------------ */

export const AI_REVIEW_COLUMNS =
  "id, inspection_id, inspection_updated_at, status, model, suggested_result, confidence, summary, findings, questions, created_at, updated_at";

export type AiReviewRow = Pick<
  Tables<"ai_reviews">,
  | "id"
  | "inspection_id"
  | "inspection_updated_at"
  | "status"
  | "model"
  | "suggested_result"
  | "confidence"
  | "summary"
  | "findings"
  | "questions"
  | "created_at"
  | "updated_at"
>;

export type StoredAiReview = {
  id: string;
  inspectionId: string;
  inspectionUpdatedAt: string;
  status: "pending" | "done" | "failed";
  /** Who wrote it: a Claude model id, or "webhook" or "mock" (aiReviewSource). */
  model: string | null;
  suggestedResult: InspectionResult | null;
  confidence: number | null;
  summary: string | null;
  findings: AiFinding[];
  questions: AiQuestion[];
  /** False when the stored findings or questions no longer parse. */
  readable: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * A pending review older than this got no answer: the longest a provider
 * may take is 30 minutes (Claude at xhigh or max effort, docs/AI.md), so
 * the request died with its server. It shows as stopped and can be asked for again.
 */
export const STALE_REVIEW_MS = 35 * 60_000;

export const STOPPED_MESSAGE = "Stopped without an answer: the server stopped before the reviewer replied.";

const FindingsSchema = z.array(AiFindingSchema);
const QuestionsSchema = z.array(AiQuestionSchema);

export function parseStoredReview(row: AiReviewRow): StoredAiReview {
  const findings = FindingsSchema.safeParse(row.findings);
  const questions = QuestionsSchema.safeParse(row.questions);
  const result = InspectionResultSchema.safeParse(row.suggested_result);
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    inspectionUpdatedAt: row.inspection_updated_at,
    status: row.status,
    model: row.model,
    suggestedResult: result.success ? result.data : null,
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null,
    summary: row.summary,
    findings: findings.success ? findings.data : [],
    questions: questions.success ? questions.data : [],
    readable: findings.success && questions.success,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A pending review that has waited longer than any provider may take. */
export function isStale(review: Pick<StoredAiReview, "status" | "createdAt">, now: number): boolean {
  return review.status === "pending" && now - Date.parse(review.createdAt) > STALE_REVIEW_MS;
}

/**
 * What goes into ai_reviews.model: the Claude model that wrote the review,
 * else the kind of reviewer, so a mock review is never taken for a real one.
 */
export function aiReviewSource(provider: AiReviewProvider, model: string | null | undefined): string {
  if (model) return model;
  return provider === "claude" ? "claude" : provider;
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  mock: "Mock reviewer (test data only)",
  webhook: "Review service (webhook)",
  claude: "Claude",
};

/** How the panel names who wrote a review. */
export function aiReviewSourceLabel(model: string | null): string | null {
  if (!model) return null;
  return SOURCE_LABEL[model] ?? model;
}

/**
 * Same instant, whatever the spelling: Postgres answers `+00:00` with up to
 * six decimals, a JavaScript Date `Z` with three. Microseconds count, so two
 * saves within one millisecond are still two versions.
 */
export function sameInstant(a: string, b: string): boolean {
  const left = instantKey(a);
  return left !== null && left === instantKey(b);
}

function instantKey(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction = "", zone] = match;
  const offset = /^z$/i.test(zone) ? "Z" : normaliseOffset(zone);
  const seconds = Date.parse(`${date}T${time}${offset}`);
  if (Number.isNaN(seconds)) return null;
  return `${seconds}.${fraction.slice(0, 6).padEnd(6, "0")}`;
}

function normaliseOffset(zone: string): string {
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4).padEnd(2, "0")}`;
}
