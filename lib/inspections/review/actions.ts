"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import {
  describeParts,
  isOrAre,
  joinWords,
  PART_VERSION_FIELD,
  PartVersionsSchema,
  planReview,
  sameParts,
  statusWord,
  type PartState,
  type PartVersion,
} from "@/lib/inspections/part-moves";
import { readPartStates } from "@/lib/inspections/part-moves-server";
import { groupRefNo, type InspectionPart } from "@/lib/inspections/parts";
import { loadParts } from "@/lib/inspections/parts-server";
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
 *
 * An inspection of several PO parts (lib/inspections/parts.ts) is approved
 * or reopened as a whole: every submitted part moves, each with its own
 * update, audit row and reopen reason, and while a part cannot move none
 * does (planReview in lib/inspections/part-moves.ts). Approving holds every
 * part to the version the page showed, as it does one.
 */

export type ReviewActionResult =
  | { status: "idle" }
  | {
      status: "success" | "warning" | "error";
      message: string;
      fieldErrors?: { reason?: string };
    };

type Verb = "approve" | "reopen";
type Client = Awaited<ReturnType<typeof createClient>>;

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

/**
 * Nothing was updated: the inspection is gone, its status moved on, it
 * changed since the admin opened it, or row level security kept the caller
 * out. Reads it again to say which. When it moved on, the page is refreshed
 * and the dialog closes with a warning, so the admin sees the new state.
 */
async function explainMiss(
  supabase: Client,
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
 * The inspection's parts could not be read: it is gone (or row level
 * security keeps the caller out), or the read failed. Reads the row once
 * more to say which.
 */
async function partsUnreadable(supabase: Client, inspectionId: string, verb: Verb): Promise<ReviewActionResult> {
  const { data, error } = await supabase.from("inspections").select("ref_no").eq("id", inspectionId).maybeSingle();
  if (error) return fail(describeError(error, verb));
  return fail(data ? REVIEW_MESSAGES.unexpected : REVIEW_MESSAGES.notFound);
}

/**
 * submitted -> approved. Only the version the admin reviewed is approved:
 * the update matches the `updated_at` the page was rendered with. Of an
 * inspection with several PO parts, every part (approveParts).
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
    // Every part the page showed, with its version: none for an inspection of one part.
    const seen = PartVersionsSchema.safeParse(formData.getAll(PART_VERSION_FIELD));
    if (!seen.success) return fail(REVIEW_MESSAGES.staleForm);

    const supabase = await createClient();
    const parts = await loadParts(supabase, inspectionId);
    if (!parts) return partsUnreadable(supabase, inspectionId, "approve");
    if (parts.length > 1 || seen.data.length > 0) return approveParts(supabase, parts, seen.data);

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
 * version, and a reason typed while someone else saved is not lost. Of an
 * inspection with several PO parts, every part (reopenParts).
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
    const parts = await loadParts(supabase, inspectionId);
    if (!parts) return partsUnreadable(supabase, inspectionId, "reopen");
    if (parts.length > 1) return reopenParts(supabase, parts, reason);

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

/* ------------------------------------------------------------------ *
 * Several PO parts
 * ------------------------------------------------------------------ */

const labels = (parts: readonly PartState[]) => joinWords(parts.map((part) => part.label));

/** "PO 2 was", "PO 2 and PO 3 were". */
const wasOrWere = (parts: readonly PartState[]) => `${labels(parts)} ${parts.length === 1 ? "was" : "were"}`;

/**
 * Every submitted part of the inspection -> approved, each only at the
 * version the page showed. Nothing moves while a part is a draft or
 * reopened, or when the page showed other parts or an older version of one.
 * The updates go one by one: should a part change in between, the parts
 * approved before it stay approved and the message says which, so the
 * admin checks the rest and approves again (an approved part is left as
 * it is).
 */
async function approveParts(supabase: Client, parts: InspectionPart[], seen: PartVersion[]): Promise<ReviewActionResult> {
  const states = await readPartStates(supabase, parts);
  if (!states || states.length === 0) return fail(REVIEW_MESSAGES.unexpected);
  const ref = groupRefNo(parts) ?? states[0].refNo;

  if (!sameParts(states, seen)) {
    refresh();
    return warn(`The POs of ${ref} changed after you opened it, so nothing was approved. The page now shows them: check them, then approve.`);
  }
  const plan = planReview(states, "approve");
  if (plan.blocked.length > 0) {
    refresh();
    return warn(`${describeParts(plan.blocked)} now, so nothing was approved. The page shows the current state.`);
  }
  if (plan.move.length === 0) {
    refresh();
    return warn(`${ref} was already approved. Nothing was changed.`);
  }
  const shown = new Map(seen.map((part) => [part.id, part.version]));
  const changed = plan.move.find((part) => shown.get(part.id) !== part.version);
  if (changed) {
    refresh();
    return warn(
      `${changed.label} changed after you opened it, so nothing was approved. The page now shows the latest version: check it, then approve it.`,
    );
  }

  const approved: PartState[] = [];
  for (const part of plan.move) {
    const { data, error } = await supabase
      .from("inspections")
      .update({ status: "approved" })
      .eq("id", part.id)
      .eq("status", "submitted")
      .eq("updated_at", part.version)
      .select("ref_no")
      .maybeSingle();
    if (error && approved.length === 0) return fail(describeError(error, "approve"));
    if (error || !data) {
      refresh();
      const before = approved.length > 0 ? `${labels(approved)} ${isOrAre(approved.length)} approved, but ` : "";
      return warn(
        error
          ? `${before}${part.label} was not approved: ${describeError(error, "approve")}`
          : `${before}${part.label} changed in between, so it was not approved. The page now shows the latest version: check it, then approve it.`,
      );
    }
    approved.push(part);
  }

  refresh();
  if (plan.done.length === 0) {
    return ok(`${ref} is approved with all ${approved.length} POs: ${labels(approved)}. It is final and can no longer be changed.`);
  }
  return ok(
    `${labels(approved)} ${isOrAre(approved.length)} approved, and ${wasOrWere(plan.done)} approved already. ${ref} is final and can no longer be changed.`,
  );
}

/**
 * Every submitted part of the inspection -> reopened, each with the reason
 * in its own audit log, so each part's screen shows it. Parts that are
 * reopened or drafts are with the inspector already and stay as they are;
 * nothing moves while a part is approved.
 */
async function reopenParts(supabase: Client, parts: InspectionPart[], reason: string): Promise<ReviewActionResult> {
  const states = await readPartStates(supabase, parts);
  if (!states || states.length === 0) return fail(REVIEW_MESSAGES.unexpected);
  const ref = groupRefNo(parts) ?? states[0].refNo;

  const plan = planReview(states, "reopen");
  if (plan.blocked.length > 0) {
    refresh();
    return warn(`${describeParts(plan.blocked)} now, so nothing was reopened. The page shows the current state.`);
  }
  if (plan.move.length === 0) {
    refresh();
    return warn(
      plan.done.every((part) => part.status === "reopened")
        ? `${ref} was already reopened. Nothing was changed.`
        : `${ref} is with the inspector already. Nothing was changed.`,
    );
  }

  const reopened: PartState[] = [];
  const unlogged: PartState[] = [];
  for (const part of plan.move) {
    const { data, error } = await supabase
      .from("inspections")
      .update({ status: "reopened" })
      .eq("id", part.id)
      .eq("status", "submitted")
      .select("ref_no")
      .maybeSingle();
    if (error && reopened.length === 0) return fail(describeError(error, "reopen"));
    if (error || !data) {
      refresh();
      const before = reopened.length > 0 ? `${labels(reopened)} ${isOrAre(reopened.length)} reopened, but ` : "";
      return warn(
        error
          ? `${before}${part.label} was not reopened: ${describeError(error, "reopen")}`
          : `${before}${part.label} changed in between, so it was not reopened. The page shows its current state.`,
      );
    }
    reopened.push(part);
    // As for one inspection: the status change is done and audited, the reason follows as its own row.
    const logged = await supabase.rpc("log_inspection_event", {
      inspection_id: part.id,
      action: REOPEN_EVENT,
      changes: { reason },
    });
    if (logged.error) {
      console.error("[inspections/review] reopened, but the reason was not logged", {
        inspection: part.id,
        code: logged.error.code,
        message: logged.error.message,
      });
      unlogged.push(part);
    }
  }

  refresh();
  if (unlogged.length > 0) {
    return warn(`${ref} is reopened, but the reason could not be saved for ${labels(unlogged)}. Tell the inspector what to change: ${reason}`);
  }
  if (plan.done.length === 0) {
    return ok(`${ref} is reopened with all ${reopened.length} POs. The inspector can change them and submit them again.`);
  }
  return ok(
    `${labels(reopened)} ${isOrAre(reopened.length)} reopened, and ${wasOrWere(plan.done)} with the inspector already. The inspector can change them and submit them again.`,
  );
}
