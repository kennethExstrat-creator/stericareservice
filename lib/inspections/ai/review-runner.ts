import "server-only";
import { after } from "next/server";
import { getAiStatus, requestAiReview, type AiReviewOutcome } from "@/lib/ai";
import {
  canExportInspection,
  evaluateRecord,
  exportFromEvaluation,
  loadInspectionRecord,
  parseInspectionId,
  type ExportClient,
  type ExportViewer,
} from "@/lib/export";
import type { InspectionExport } from "@/lib/schemas/export";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { asJson, logInspectionEvent } from "./audit";
import { AI_STATUSES, ALREADY_PENDING, NOT_REVIEWABLE } from "./panel-model";
import { aiReviewSource, isStale, parseStoredReview, sameInstant, STOPPED_MESSAGE, AI_REVIEW_COLUMNS } from "./stored";

/* ------------------------------------------------------------------ *
 * The AI second opinion (BUILD_SPEC 9.2): a pending ai_reviews row for
 * the inspection's current version, then the export goes to the
 * configured reviewer in the background (after()), and the row becomes
 * done, with the review, or failed, with the reason. The AI never
 * changes the inspection: nothing here writes to it.
 *
 * A Claude review can take minutes (10, or 30 at xhigh and max effort),
 * so the request returns at once and the panel waits for the row. The
 * route that runs the action needs a maxDuration above that limit.
 * ------------------------------------------------------------------ */

export type AiReviewTrigger = "admin" | "submit";

export type StartAiReviewFailure =
  | "not_connected"
  | "not_found"
  | "not_reviewable"
  | "pending"
  | "export_failed"
  | "database_error";

export type StartAiReviewResult =
  | { ok: true; reviewId: string; inspectionUpdatedAt: string }
  | { ok: false; reason: StartAiReviewFailure; message: string };

export type StartAiReviewInput = {
  /** Reads the inspection and writes the pending row: the admin's own client, or the service role. */
  client: ExportClient;
  inspectionId: string;
  trigger: AiReviewTrigger;
  /** The admin asking; left out for the submit trigger, which runs as the service role. */
  viewer?: ExportViewer;
  now?: () => number;
};

export async function startAiReview(input: StartAiReviewInput): Promise<StartAiReviewResult> {
  const { client, inspectionId, trigger, viewer } = input;
  const now = input.now?.() ?? Date.now();

  const status = getAiStatus().review;
  if (!status.connected) {
    return { ok: false, reason: "not_connected", message: status.detail ? `${status.label}. ${status.detail}` : `${status.label}.` };
  }

  const id = parseInspectionId(inspectionId);
  if (!id) return { ok: false, reason: "not_found", message: "Inspection not found." };
  // The inspection and any review in progress, side by side.
  const [loaded, running] = await Promise.all([
    loadInspectionRecord(client, id),
    client.from("ai_reviews").select(AI_REVIEW_COLUMNS).eq("inspection_id", id).eq("status", "pending"),
  ]);
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason === "not_found" ? "not_found" : "database_error", message: loaded.message };
  }
  const { record } = loaded;
  if (viewer && !canExportInspection(viewer, record)) return { ok: false, reason: "not_found", message: "Inspection not found." };
  if (!AI_STATUSES.includes(record.status)) return { ok: false, reason: "not_reviewable", message: NOT_REVIEWABLE };

  // One review at a time per version: a second request would be paid for twice.
  if (running.error) return databaseError("Could not check for a review in progress.", running.error);
  for (const review of running.data.map(parseStoredReview)) {
    if (isStale(review, now)) {
      // Its server stopped before it could answer; record that, then go on.
      await client
        .from("ai_reviews")
        .update({ status: "failed", summary: STOPPED_MESSAGE })
        .eq("id", review.id)
        .eq("status", "pending");
    } else if (sameInstant(review.inspectionUpdatedAt, record.updatedAt)) {
      return { ok: false, reason: "pending", message: `${ALREADY_PENDING} It appears here when it is ready.` };
    }
  }

  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) return { ok: false, reason: "export_failed", message: evaluation.message };
  const built = await exportFromEvaluation(client, record, evaluation.evaluated);
  if (!built.ok) return { ok: false, reason: "export_failed", message: built.message };

  const provider = status.provider === "claude" || status.provider === "webhook" || status.provider === "mock" ? status.provider : null;
  const inserted = await client
    .from("ai_reviews")
    .insert({
      inspection_id: record.id,
      inspection_updated_at: record.updatedAt,
      status: "pending",
      model: provider ? aiReviewSource(provider, status.model) : null,
    })
    .select("id")
    .single();
  if (inserted.error) return databaseError("Could not save the review request.", inserted.error);
  const reviewId = inserted.data.id;

  await logInspectionEvent(client, record.id, "ai_review.requested", {
    reviewId,
    trigger,
    provider,
    inspectionUpdatedAt: record.updatedAt,
  });

  const exportDoc = built.export;
  const fallbackWriter = client;
  after(() => completeAiReview({ reviewId, inspectionId: record.id, exportDoc, writer: backgroundWriter(fallbackWriter) }));
  return { ok: true, reviewId, inspectionUpdatedAt: record.updatedAt };
}

export type CompleteAiReviewInput = {
  reviewId: string;
  inspectionId: string;
  exportDoc: InspectionExport;
  /** Stores the outcome. */
  writer: ExportClient;
  /** For tests: the reviewer call. */
  review?: (doc: InspectionExport) => Promise<AiReviewOutcome>;
};

/** Asks the reviewer and stores its answer on the pending row. Never throws. */
export async function completeAiReview(input: CompleteAiReviewInput): Promise<"done" | "failed" | "not_stored"> {
  const { reviewId, inspectionId, exportDoc, writer } = input;
  let outcome: AiReviewOutcome;
  try {
    outcome = await (input.review ?? requestAiReview)(exportDoc);
  } catch (error) {
    console.error("[ai review] the reviewer threw", error);
    outcome = { ok: false, reason: "error", message: "Unexpected error while requesting the AI review." };
  }

  const update: TablesUpdate<"ai_reviews"> = outcome.ok
    ? {
        status: "done",
        model: aiReviewSource(outcome.provider, outcome.model),
        suggested_result: outcome.review.suggestedResult,
        confidence: outcome.review.confidence,
        summary: outcome.review.summary,
        findings: asJson(outcome.review.findings),
        questions: asJson(outcome.review.questions),
      }
    : {
        status: "failed",
        summary: outcome.message,
        ...(outcome.provider ? { model: aiReviewSource(outcome.provider, null) } : {}),
      };

  try {
    const { data, error } = await writer
      .from("ai_reviews")
      .update(update)
      .eq("id", reviewId)
      .eq("status", "pending")
      .select("id");
    if (error || !data?.length) {
      console.error("[ai review] the outcome could not be stored", { reviewId, error: error?.message });
      return "not_stored";
    }
    await logInspectionEvent(writer, inspectionId, outcome.ok ? "ai_review.done" : "ai_review.failed", {
      reviewId,
      provider: outcome.ok ? outcome.provider : (outcome.provider ?? null),
      ...(outcome.ok
        ? {
            model: outcome.model,
            suggestedResult: outcome.review.suggestedResult,
            findings: outcome.review.findings.length,
            ...(outcome.usage ? { usage: outcome.usage } : {}),
          }
        : { reason: outcome.reason }),
    });
    return outcome.ok ? "done" : "failed";
  } catch (error) {
    console.error("[ai review] storing the outcome threw", error);
    return "not_stored";
  }
}

/**
 * The second opinion on submit, when the template asks for it (BUILD_SPEC
 * 9.2 "Trigger"). Inspectors cannot write ai_reviews, so this runs as the
 * service role (docs/DATABASE.md, "Notes for app code"). Call it from the
 * submit action after the status change; it never throws and does nothing
 * when no reviewer is connected.
 */
export async function scheduleAiReviewOnSubmit(inspectionId: string): Promise<StartAiReviewResult> {
  if (!getAiStatus().review.connected) {
    return { ok: false, reason: "not_connected", message: "AI second opinion not connected." };
  }
  if (!isAdminClientConfigured()) {
    return { ok: false, reason: "database_error", message: "The server needs SUPABASE_SECRET_KEY to start a review on submit." };
  }
  try {
    return await startAiReview({ client: createAdminClient(), inspectionId, trigger: "submit" });
  } catch (error) {
    console.error("[ai review] starting the review on submit threw", error);
    return { ok: false, reason: "database_error", message: "The second opinion could not be started." };
  }
}

/**
 * The background part stores its answer with the service role when the
 * server has it: a review can outlast the admin's access token, and only
 * the row this request created is touched. Without the secret key the
 * admin's own client is used.
 */
function backgroundWriter(fallback: ExportClient): ExportClient {
  return isAdminClientConfigured() ? createAdminClient() : fallback;
}

function databaseError(message: string, error: { code?: string; message: string }): StartAiReviewResult {
  console.error(`[ai review] ${message}`, { code: error.code, message: error.message });
  return { ok: false, reason: "database_error", message: `${message} Try again.` };
}
