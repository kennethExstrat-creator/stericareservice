"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { parseInspectionId } from "@/lib/export";
import { createClient } from "@/lib/supabase/server";
import { decisionMessage, recordFindingDecision } from "./decisions";
import { sendInspectionToAiReport } from "./report";
import { startAiReview } from "./review-runner";
import { AI_REVIEW_COLUMNS, isStale, parseStoredReview } from "./stored";
import type { AiActionState, AiReviewProgress } from "./types";

/*
 * Server Actions for the AI hand-offs (BUILD_SPEC 9). Server Actions are
 * public HTTP endpoints: each checks the caller with authorizeAction() first
 * (the decisions and both hand-offs are admin work, each behind its role's
 * switch: Steri-AI Second Opinion for the review and its decisions, Export
 * Reports for the report), validates its input with zod, and reads and
 * writes through the caller's own client, so Row Level Security and the
 * database guards check everything again. None of them changes an
 * inspection's result: the AI suggests, the admin decides.
 */

const InspectionFormSchema = z.object({ inspectionId: z.string() });

/** authorizeAction's words for a caller it does not allow. */
const NOT_ALLOWED = "You do not have permission to do that.";

/** "Request AI Second Opinion": stores a pending review of the current version and runs it in the background. */
export async function requestAiSecondOpinion(_previous: AiActionState, formData: FormData): Promise<AiActionState> {
  return guarded("requestAiSecondOpinion", async () => {
    const auth = await authorizeAction({ permission: "ai_second_opinion" });
    if (!auth.ok) return failure(auth.error);
    const inspectionId = inspectionIdFrom(formData);
    if (!inspectionId) return failure("That inspection could not be found. Reload the page.");

    const started = await startAiReview({
      client: await createClient(),
      inspectionId,
      trigger: "admin",
      viewer: { id: auth.user.id, role: auth.user.role },
    });
    if (!started.ok) return failure(started.message);
    refresh();
    return {
      status: "success",
      message: "Second opinion requested. It can take a few minutes; this panel updates when it is ready.",
    };
  });
}

/** Agree, disagree (with a note) or fixed, on one finding of a finished review. */
export async function recordAiFindingDecision(_previous: AiActionState, formData: FormData): Promise<AiActionState> {
  return guarded("recordAiFindingDecision", async () => {
    const auth = await authorizeAction({ permission: "ai_second_opinion" });
    if (!auth.ok) return failure(auth.error);

    const result = await recordFindingDecision(await createClient(), {
      reviewId: field(formData, "reviewId"),
      findingId: field(formData, "findingId"),
      action: field(formData, "action"),
      note: field(formData, "note"),
    });
    if (!result.ok) return { status: "error", message: result.message, fieldErrors: result.fieldErrors };
    refresh();
    return { status: "success", message: decisionMessage(result.decision) };
  });
}

/** "Send to AI Report": the export goes to the report service; its link is stored on the inspection. */
export async function sendToAiReport(_previous: AiActionState, formData: FormData): Promise<AiActionState> {
  return guarded("sendToAiReport", async () => {
    const auth = await authorizeAction({ permission: "export_reports" });
    if (!auth.ok) return failure(auth.error);
    // And the role level, as before roles: the link is stored on a submitted or approved
    // inspection, which only someone who sees every inspection may write.
    if (auth.user.role !== "admin") return failure(NOT_ALLOWED);
    const inspectionId = inspectionIdFrom(formData);
    if (!inspectionId) return failure("That inspection could not be found. Reload the page.");

    const sent = await sendInspectionToAiReport({
      client: await createClient(),
      inspectionId,
      viewer: { id: auth.user.id, role: auth.user.role },
    });
    if (sent.ok) {
      refresh();
      return { status: "success", message: "Steri-AI's report is ready.", reportUrl: sent.reportUrl };
    }
    if (sent.reason === "not_connected") {
      return { status: "not_connected", message: sent.message, downloadHref: sent.downloadHref };
    }
    return failure(sent.message);
  });
}

/**
 * Which of the inspection's reviews are still being written, for the panel's
 * poller. Readable by whoever may read the inspection's reviews (RLS).
 */
export async function getAiReviewProgress(inspectionId: string): Promise<AiReviewProgress> {
  try {
    const auth = await authorizeAction();
    const id = parseInspectionId(inspectionId);
    if (!auth.ok || !id) return { ok: false };
    const { data, error } = await (await createClient())
      .from("ai_reviews")
      .select(AI_REVIEW_COLUMNS)
      .eq("inspection_id", id)
      .eq("status", "pending");
    if (error) return { ok: false };
    const now = Date.now();
    return {
      ok: true,
      pending: data.map(parseStoredReview).filter((review) => !isStale(review, now)).map((review) => review.id),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ai actions] getAiReviewProgress failed", error);
    return { ok: false };
  }
}

/* ------------------------------------------------------------------ */

/** Unexpected failures become a message on the form instead of an error page. */
async function guarded(name: string, run: () => Promise<AiActionState>): Promise<AiActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[ai actions] ${name} failed`, error);
    return failure("Something went wrong. Try again.");
  }
}

function failure(message: string): AiActionState {
  return { status: "error", message };
}

function inspectionIdFrom(formData: FormData): string | null {
  const parsed = InspectionFormSchema.safeParse({ inspectionId: field(formData, "inspectionId") });
  return parsed.success ? parseInspectionId(parsed.data.inspectionId) : null;
}

/** A text field; files and missing fields read as undefined. */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
