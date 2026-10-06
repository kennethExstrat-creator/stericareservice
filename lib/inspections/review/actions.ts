"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import type { InspectionStatus } from "@/lib/schemas/common";
import { createClient } from "@/lib/supabase/server";
import { REOPEN_EVENT, REVIEW_MESSAGES, ReopenInputSchema, ReviewTargetSchema } from "./schemas";

/*
 * Approve and reopen (BUILD_SPEC 5: submitted -> approved, submitted ->
 * reopened). Server Actions are public HTTP endpoints, so each one checks the
 * caller is an active admin and validates its input with zod before it
 * touches the database. The status change is a plain update through the
 * admin's own client: row level security and the inspections guard check
 * the transition again, set approved_by and approved_at, and write the
 * audit row. The reopen reason goes into the audit log right after.
 */

export type ReviewActionResult =
  | { status: "idle" }
  | {
      status: "success" | "warning" | "error";
      message: string;
      fieldErrors?: { reason?: string };
    };

type Verb = "approve" | "reopen";

const ok = (message: string): ReviewActionResult => ({ status: "success", message });
const warn = (message: string): ReviewActionResult => ({ status: "warning", message });
const fail = (message: string, fieldErrors?: { reason?: string }): ReviewActionResult => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

type DatabaseError = { code?: string; message: string };

/** Unexpected failures become a message in the dialog instead of an error page. */
async function guarded(name: string, run: () => Promise<ReviewActionResult>): Promise<ReviewActionResult> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[inspections/review] ${name} failed`, error);
    return fail(REVIEW_MESSAGES.unexpected);
  }
}

function field(formData: FormData, name: string): FormDataEntryValue | null {
  return formData.get(name);
}

function firstMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? REVIEW_MESSAGES.unexpected;
}

/** A refused update in plain words. Details go to the server log, not the screen. */
function describeError(error: DatabaseError, verb: Verb): string {
  if (error.code === "42501") return `You do not have permission to ${verb} inspections.`;
  if (error.code === "23514") {
    return `This inspection cannot be ${verb === "approve" ? "approved" : "reopened"} now: only submitted inspections can.`;
  }
  if (error.code === "PGRST301" || error.code === "PGRST303") return "Your session has ended. Sign in again.";
  console.error(`[inspections/review] ${verb} refused`, { code: error.code, message: error.message });
  return REVIEW_MESSAGES.unexpected;
}

/** "is a draft", "is reopened". */
function statusWord(status: InspectionStatus): string {
  return status === "draft" ? "a draft" : INSPECTION_STATUS_LABEL[status].toLowerCase();
}

/**
 * Nothing was updated: the inspection is gone, its status moved on, it
 * changed since the admin opened it, or row level security kept the caller
 * out. Reads it again to say which. When it moved on, the page is refreshed
 * and the dialog closes with a warning, so the admin sees the new state.
 */
async function explainMiss(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string,
  verb: Verb,
  version: string | null,
): Promise<ReviewActionResult> {
  const { data, error } = await supabase
    .from("inspections")
    .select("ref_no, status, updated_at")
    .eq("id", inspectionId)
    .maybeSingle();
  if (error) return fail(describeError(error, verb));
  if (!data) return fail(REVIEW_MESSAGES.notFound);

  const done = verb === "approve" ? "approved" : "reopened";
  if (data.status === done) {
    refresh();
    return warn(`${data.ref_no} was already ${done}. Nothing was changed.`);
  }
  if (data.status !== "submitted") {
    refresh();
    return warn(`${data.ref_no} is ${statusWord(data.status)} now, so it was not ${done}. The page shows its current state.`);
  }
  if (version !== null && data.updated_at !== version) {
    refresh();
    return warn(
      `${data.ref_no} changed after you opened it, so it was not approved. The page now shows the latest version: check it, then approve it.`,
    );
  }
  // Still submitted and unchanged, yet not updated: row level security kept this account out.
  return fail(`You do not have permission to ${verb} inspections.`);
}

/**
 * submitted -> approved. Only the version the admin reviewed is approved:
 * the update matches the `updated_at` the page was rendered with.
 */
export async function approveInspection(_previous: ReviewActionResult, formData: FormData): Promise<ReviewActionResult> {
  return guarded("approveInspection", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = ReviewTargetSchema.safeParse({
      inspectionId: field(formData, "inspectionId"),
      version: field(formData, "version"),
    });
    if (!parsed.success) return fail(firstMessage(parsed.error));
    const { inspectionId, version } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inspections")
      .update({ status: "approved" })
      .eq("id", inspectionId)
      .eq("status", "submitted")
      .eq("updated_at", version)
      .select("ref_no")
      .maybeSingle();
    if (error) return fail(describeError(error, "approve"));
    if (!data) return explainMiss(supabase, inspectionId, "approve", version);

    refresh();
    return ok(`${data.ref_no} is approved. It is final and can no longer be changed.`);
  });
}

/**
 * submitted -> reopened, with the reason the inspector sees. Reopening is
 * not final (the inspector submits again), so it applies to the current
 * version, and a reason typed while someone else saved is not lost.
 */
export async function reopenInspection(_previous: ReviewActionResult, formData: FormData): Promise<ReviewActionResult> {
  return guarded("reopenInspection", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return fail(auth.error);

    const parsed = ReopenInputSchema.safeParse({
      inspectionId: field(formData, "inspectionId"),
      reason: field(formData, "reason"),
    });
    if (!parsed.success) {
      const reasonIssue = parsed.error.issues.find((issue) => issue.path[0] === "reason");
      return reasonIssue ? fail(reasonIssue.message, { reason: reasonIssue.message }) : fail(firstMessage(parsed.error));
    }
    const { inspectionId, reason } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inspections")
      .update({ status: "reopened" })
      .eq("id", inspectionId)
      .eq("status", "submitted")
      .select("ref_no")
      .maybeSingle();
    if (error) return fail(describeError(error, "reopen"));
    if (!data) return explainMiss(supabase, inspectionId, "reopen", null);

    // The status change is done and audited; the reason follows as its own row.
    const logged = await supabase.rpc("log_inspection_event", {
      inspection_id: inspectionId,
      action: REOPEN_EVENT,
      changes: { reason },
    });
    refresh();
    if (logged.error) {
      console.error("[inspections/review] reopened, but the reason was not logged", {
        code: logged.error.code,
        message: logged.error.message,
      });
      return warn(`${data.ref_no} is reopened, but the reason could not be saved. Tell the inspector what to change: ${reason}`);
    }
    return ok(`${data.ref_no} is reopened. The inspector can change it and submit it again.`);
  });
}
