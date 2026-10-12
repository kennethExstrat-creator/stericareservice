"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { authorizeAction } from "@/lib/auth/session";
import { scheduleAiReviewOnSubmit } from "@/lib/inspections/ai";
import { captureAccess, isEditableStatus } from "@/lib/inspections/capture/access";
import { changedEntryProblems, describeProblems } from "@/lib/inspections/capture/changes";
import { evaluateCapture, storedTemplateWithShownTitles } from "@/lib/inspections/capture/evaluate";
import { blockedSubmitMessage, neededSectionCount } from "@/lib/inspections/capture/issues";
import { loadCaptureInspection, type CaptureInspection } from "@/lib/inspections/capture/load";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
import {
  switchOffProblem,
  switchOnProblem,
  withOverride,
  withoutOverride,
} from "@/lib/inspections/capture/overrides";
import {
  SaveInputSchema,
  SubmitInputSchema,
  SwitchOffInputSchema,
  SwitchOnInputSchema,
} from "@/lib/inspections/capture/schemas";
import { serverWriter, submitInspectionRow } from "@/lib/inspections/writes";
import { FAILURE_MESSAGES, saveInspectionData, type SaveOutcome } from "@/lib/offline";
import { contentHash } from "@/lib/offline/stable-json";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { ValidationIssue } from "@/lib/validation";
import type { InspectionData } from "@/modules/_framework";

/*
 * Server Actions of the capture screen (BUILD_SPEC 8 and 10). They are public
 * HTTP endpoints: each one checks the session first (authorizeAction),
 * validates its input with zod and re-reads the inspection with the user's
 * own client, so Row Level Security decides what the user may see. A save
 * and a submit are then written with the secret key, for the user, through
 * public.save_inspection() and submit_inspection() (lib/inspections/writes.ts):
 * the database refuses an inspector's own writes, since only these actions
 * check the data, and checks the user again. Module overrides are plain
 * updates with the admin's own client, which the inspections guard checks
 * (admins only) and audits.
 *
 * Saving from two devices: every save is a compare-and-set on
 * inspections.updated_at (docs/OFFLINE.md, "The transport"). A save names
 * the version its data was edited from and is written only while the row is
 * still at that version; otherwise the action answers "conflict" with the
 * row's current data and version, and the device's autosave decides: it
 * sends again on top of the new version when the server's data is what this
 * device last saved or sent (only other columns moved, such as an admin
 * switching a module off, or a save whose answer was lost), and otherwise
 * stops and asks the inspector which version to keep. Nothing is merged and
 * nothing is overwritten silently.
 *
 * A save also answers the inspection's status and module overrides as it
 * found them (`state`), when they belong to the version it answers: the
 * screen follows a section switched off or on, or a submit, made elsewhere.
 */

/* ------------------------------------------------------------------ *
 * Autosave
 * ------------------------------------------------------------------ */

/** What the screen follows from the server besides the data: who changed what elsewhere. */
export type CaptureServerState = { status: InspectionStatus; overrides: ModuleOverrides };

/** lib/offline's save outcome, with the inspection's state where it belongs to the answered version. */
export type CaptureSaveOutcome = SaveOutcome<InspectionData> & { state?: CaptureServerState };

function stateOf(row: Pick<CaptureInspection, "status" | "overrides">): CaptureServerState {
  return { status: row.status, overrides: row.overrides };
}

/**
 * The autosave transport (lib/offline). Saves the whole data of a draft or
 * reopened inspection, checks every changed entry against its module's
 * schema, and writes the columns that mirror the data in the same update.
 */
export async function saveCaptureData(input: unknown): Promise<CaptureSaveOutcome> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, reason: "unauthorized", message: auth.error };

    const parsed = SaveInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid", message: FAILURE_MESSAGES.invalid };
    const request = parsed.data;

    const supabase = await createClient();
    // With its files: the mirrored suggestion counts a deleted lab report as the screen does.
    const loaded = await loadCaptureInspection(supabase, request.inspectionId, { files: true });
    if (loaded.kind === "not_found") return { ok: false, reason: "not_found", message: FAILURE_MESSAGES.not_found };
    if (loaded.kind === "template_unreadable") {
      return { ok: false, reason: "invalid", message: "This inspection's template cannot be read. Ask an admin." };
    }
    const row = loaded.inspection;

    const access = captureAccess({
      status: row.status,
      role: auth.user.role,
      userId: auth.user.id,
      inspectorId: row.inspectorId,
    });
    if (!access.editable) return { ok: false, reason: "forbidden", message: readOnlyMessage(row), state: stateOf(row) };

    // Someone saved in between: the device decides (see the note at the top).
    if (row.updatedAt !== request.baseUpdatedAt) {
      return { ok: false, reason: "conflict", server: { data: row.data, updatedAt: row.updatedAt }, state: stateOf(row) };
    }

    // Named as the screen names them: a count in a title as the stored data has it.
    const problems = changedEntryProblems(row.data, request.data, shownTemplate(row));
    if (problems.length > 0) return { ok: false, reason: "invalid", message: describeProblems(problems) };

    const evaluation = evaluateCapture({
      template: row.template.resolved,
      overrides: row.overrides,
      data: request.data,
      meta: row.meta,
    });
    const outcome = await saveInspectionData(supabase, request, {
      columns: () => mirroredColumns(evaluation),
      writer: serverWriter(auth.user.id),
    });
    // Written on the version just read: its status and overrides are the row's. A missed
    // compare-and-set answers a later read, which they may not match: none then.
    return outcome.ok ? { ...outcome, state: stateOf(row) } : outcome;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[capture] save failed", error);
    return { ok: false, reason: "server", message: FAILURE_MESSAGES.server };
  }
}

/* ------------------------------------------------------------------ *
 * Submit
 * ------------------------------------------------------------------ */

export type SubmitResult =
  | { status: "idle" }
  /**
   * Validation errors on the saved data: submit waits until they are fixed.
   * With the overrides they were found with, which may have changed on
   * another device since the screen loaded.
   */
  | { status: "blocked"; message: string; errors: ValidationIssue[]; overrides: ModuleOverrides }
  | { status: "error"; message: string };

/**
 * Moves a draft or reopened inspection to submitted, then opens its review.
 * The screen has saved everything and checked the upload queue first; here
 * the saved data must be exactly what the inspector validated (`dataHash`)
 * and must have no errors (BUILD_SPEC 6.2). The database checks the user
 * and the transition, stamps submitted_at and writes the audit row in the
 * user's name.
 */
export async function submitInspection(input: unknown): Promise<SubmitResult> {
  let reviewPath: string;
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = SubmitInputSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: "The request was not understood. Reload the page and try again." };
    const { inspectionId, dataHash } = parsed.data;

    const supabase = await createClient();
    const loaded = await loadCaptureInspection(supabase, inspectionId, { files: true });
    if (loaded.kind === "not_found") return { status: "error", message: FAILURE_MESSAGES.not_found };
    if (loaded.kind === "template_unreadable") {
      return { status: "error", message: "This inspection's template cannot be read. Ask an admin." };
    }
    const row = loaded.inspection;
    reviewPath = `/inspections/${row.id}/review`;

    // Submitted already (a second tap, or another device): the review is where to go.
    if (row.status !== "submitted") {
      const access = captureAccess({
        status: row.status,
        role: auth.user.role,
        userId: auth.user.id,
        inspectorId: row.inspectorId,
      });
      if (!access.editable) return { status: "error", message: readOnlyMessage(row) };

      if (contentHash(row.data) !== dataHash) {
        return {
          status: "error",
          message:
            "This inspection changed on another device since this one last saved. Reload the page to see the latest version, then submit.",
        };
      }

      const evaluation = evaluateCapture({
        template: row.template.resolved,
        overrides: row.overrides,
        data: row.data,
        meta: row.meta,
      });
      const { errors } = evaluation.report;
      if (errors.length > 0) {
        return {
          status: "blocked",
          message: blockedSubmitMessage(neededSectionCount(errors)),
          errors,
          overrides: row.overrides,
        };
      }

      const written = await submitInspectionRow(supabase, serverWriter(auth.user.id), {
        inspectionId: row.id,
        // Unchanged since it was validated above.
        baseUpdatedAt: row.updatedAt,
        columns: mirroredColumns(evaluation),
      });
      if ("error" in written) {
        console.error("[capture] submit refused", written.error.code, written.error.message);
        return { status: "error", message: submitErrorMessage(written.error.code) };
      }
      if (!written.submitted) {
        return {
          status: "error",
          message: "This inspection changed while it was being submitted. Reload the page, then submit again.",
        };
      }
      if (row.template.aiReviewOnSubmit) await startReviewOnSubmit(row.id, auth.user.id);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("[capture] submit failed", error);
    return { status: "error", message: "The inspection could not be submitted. Try again in a moment." };
  }
  redirect(reviewPath);
}

/** How long submit waits for the AI review to start before it opens the review anyway. */
const AI_START_WAIT_MS = 3_000;

/**
 * The AI second opinion on submit, when the template asks for it (BUILD_SPEC
 * 9.2 "Trigger"): started once the inspection is submitted, as the service
 * role (inspectors cannot write ai_reviews). It never fails the submit and
 * holds it up for AI_START_WAIT_MS at most: started by then, the review shows
 * it pending; otherwise it starts in the background all the same (after()
 * keeps the request alive for it). Nothing happens when no reviewer is
 * connected. The review's cost is recorded in the name of the user who
 * submitted.
 */
async function startReviewOnSubmit(inspectionId: string, actorId: string): Promise<void> {
  const started = scheduleAiReviewOnSubmit(inspectionId, actorId).then(
    (result) => {
      if (!result.ok && result.reason !== "not_connected" && result.reason !== "pending") {
        console.error(`[capture] the AI second opinion did not start on submit: ${result.message}`);
      }
    },
    (error: unknown) => console.error("[capture] the AI second opinion did not start on submit", error),
  );
  after(() => started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, AI_START_WAIT_MS);
  });
  await Promise.race([started, waited]);
  clearTimeout(timer);
}

function submitErrorMessage(code: string | undefined): string {
  if (code === "42501") return "You cannot submit this inspection.";
  if (code === "23514") return "This inspection cannot be submitted from its current status. Reload the page.";
  return "The inspection could not be submitted. Try again in a moment.";
}

/* ------------------------------------------------------------------ *
 * Module overrides (admins)
 * ------------------------------------------------------------------ */

export type OverrideResult =
  | { status: "idle" }
  | { status: "success" | "warning"; message: string; overrides: ModuleOverrides }
  | { status: "error"; message: string; fieldError?: string };

/**
 * Switches a module off for this inspection with a reason (BUILD_SPEC 4.4).
 * Its data stays saved; capture, validation and the export leave it out and
 * the export lists it with the reason. Logged as `module_override`.
 */
export async function switchModuleOff(_previous: OverrideResult, formData: FormData): Promise<OverrideResult> {
  return guardedOverride("switchModuleOff", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = SwitchOffInputSchema.safeParse({
      inspectionId: formData.get("inspectionId"),
      moduleKey: formData.get("moduleKey"),
      reason: formData.get("reason") ?? "",
    });
    if (!parsed.success) {
      const reasonIssue = parsed.error.issues.find((issue) => issue.path[0] === "reason");
      if (reasonIssue) return { status: "error", message: reasonIssue.message, fieldError: reasonIssue.message };
      return { status: "error", message: "The request was not understood. Reload the page and try again." };
    }
    const { inspectionId, moduleKey, reason } = parsed.data;

    const supabase = await createClient();
    return updateOverrides(supabase, inspectionId, (row) => {
      const template = shownTemplate(row);
      const problem = switchOffProblem(template, row.overrides, moduleKey);
      if (problem) return { problem };
      return {
        next: withOverride(row.overrides, moduleKey, { reason, by: auth.user.id, at: new Date().toISOString() }),
        event: { module: moduleKey, include: false, reason },
        message: `${titleOf(template, moduleKey)} is switched off for this inspection.`,
      };
    });
  });
}

/** Switches a module back on; its saved data returns with it. Logged as `module_override`. */
export async function switchModuleOn(_previous: OverrideResult, formData: FormData): Promise<OverrideResult> {
  return guardedOverride("switchModuleOn", async () => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = SwitchOnInputSchema.safeParse({
      inspectionId: formData.get("inspectionId"),
      moduleKey: formData.get("moduleKey"),
    });
    if (!parsed.success) {
      return { status: "error", message: "The request was not understood. Reload the page and try again." };
    }
    const { inspectionId, moduleKey } = parsed.data;

    const supabase = await createClient();
    return updateOverrides(supabase, inspectionId, (row) => {
      const template = shownTemplate(row);
      const problem = switchOnProblem(template, row.overrides, moduleKey);
      if (problem) return { problem };
      return {
        next: withoutOverride(row.overrides, moduleKey),
        event: { module: moduleKey, include: true, previousReason: row.overrides[moduleKey]?.reason ?? null },
        message: `${titleOf(template, moduleKey)} is switched back on.`,
      };
    });
  });
}

type OverridePlan =
  | { problem: string }
  | { next: ModuleOverrides; event: Record<string, Json>; message: string };

/** Lost updates: an override written on another device in between makes the write miss, and it is tried once more. */
const OVERRIDE_ATTEMPTS = 2;

async function updateOverrides(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string,
  plan: (row: CaptureInspection) => OverridePlan,
): Promise<OverrideResult> {
  for (let attempt = 0; attempt < OVERRIDE_ATTEMPTS; attempt += 1) {
    const loaded = await loadCaptureInspection(supabase, inspectionId, { files: true });
    if (loaded.kind === "not_found") return { status: "error", message: FAILURE_MESSAGES.not_found };
    if (loaded.kind === "template_unreadable") {
      return { status: "error", message: "This inspection's template cannot be read." };
    }
    const row = loaded.inspection;
    if (row.status === "approved") return { status: "error", message: "An approved inspection is read-only." };

    const planned = plan(row);
    if ("problem" in planned) return { status: "error", message: planned.problem };

    // The suggestion leaves out what is switched off, so it follows the change.
    const { report } = evaluateCapture({
      template: row.template.resolved,
      overrides: planned.next,
      data: row.data,
      meta: row.meta,
    });
    const { data: written, error } = await supabase
      .from("inspections")
      .update({ module_overrides: planned.next as NonNullable<Json>, suggested_result: report.suggested.result })
      .eq("id", row.id)
      .eq("updated_at", row.updatedAt)
      .select("id");
    if (error) {
      console.error("[capture] override refused", error.code, error.message);
      return {
        status: "error",
        message: error.code === "42501" ? "Only an admin can switch sections off or on." : "The change could not be saved. Try again.",
      };
    }
    if (!written || written.length === 0) continue;

    const logged = await supabase.rpc("log_inspection_event", {
      inspection_id: row.id,
      action: "module_override",
      changes: planned.event,
    });
    if (logged.error) {
      console.error("[capture] override not logged", logged.error.code, logged.error.message);
      return {
        status: "warning",
        message: `${planned.message} The change could not be added to the audit log.`,
        overrides: planned.next,
      };
    }
    return { status: "success", message: planned.message, overrides: planned.next };
  }
  return { status: "error", message: "This inspection kept changing while it was being updated. Try again." };
}

async function guardedOverride(name: string, run: () => Promise<OverrideResult>): Promise<OverrideResult> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[capture] ${name} failed`, error);
    return { status: "error", message: "The change could not be saved. Try again in a moment." };
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * The template version as stored, with the titles this inspection shows (a
 * count in a title follows the inspection), so a message names a section as
 * the screen does.
 */
function shownTemplate(row: CaptureInspection): ResolvedTemplate {
  return storedTemplateWithShownTitles({
    template: row.template.resolved,
    overrides: row.overrides,
    data: row.data,
    meta: row.meta,
  });
}

function titleOf(template: ResolvedTemplate, key: string): string {
  return template.modules.find((entry) => entry.key === key)?.title ?? key;
}

function readOnlyMessage(row: Pick<CaptureInspection, "status">): string {
  if (row.status === "approved") return "This inspection is approved and can no longer be changed.";
  if (!isEditableStatus(row.status)) return "This inspection has been submitted and can no longer be changed here.";
  return "This inspection can no longer be changed from this account.";
}
