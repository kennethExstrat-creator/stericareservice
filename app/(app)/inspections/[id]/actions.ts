"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { authorizeAction } from "@/lib/auth/session";
import { scheduleAiReviewOnSubmit } from "@/lib/inspections/ai";
import { captureAccess, isEditableStatus, type UserRole } from "@/lib/inspections/capture/access";
import { changedEntryProblems, describeProblems } from "@/lib/inspections/capture/changes";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
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
import {
  isOrAre,
  joinWords,
  partNeedsMessage,
  sameParts,
  SubmitPartIdsSchema,
  type SubmitPartProblem,
} from "@/lib/inspections/part-moves";
import { partLabel, type InspectionPart } from "@/lib/inspections/parts";
import { loadParts } from "@/lib/inspections/parts-server";
import { serverWriter, submitInspectionRow } from "@/lib/inspections/writes";
import { FAILURE_MESSAGES, saveInspectionData, type MirroredColumns, type SaveOutcome } from "@/lib/offline";
import { contentHash } from "@/lib/offline/stable-json";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { ModuleOverrides } from "@/lib/schemas/template";
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

    const problems = changedEntryProblems(row.data, request.data, row.template.resolved);
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
  /** With the other PO parts that keep the inspection from being submitted, each to link to. */
  | { status: "error"; message: string; parts?: SubmitPartProblem[] };

/** The submit request; with several PO parts, the parts its confirmation named. */
const SubmitRequestSchema = SubmitInputSchema.extend({ partIds: SubmitPartIdsSchema.optional() });

const SUBMIT_FAILED = "The inspection could not be submitted. Try again in a moment.";

type Client = Awaited<ReturnType<typeof createClient>>;
type Submitter = { id: string; role: UserRole };

/**
 * Moves a draft or reopened inspection to submitted, then opens its review.
 * The screen has saved everything and checked the upload queue first; here
 * the saved data must be exactly what the inspector validated (`dataHash`)
 * and must have no errors (BUILD_SPEC 6.2). The database checks the user
 * and the transition, stamps submitted_at and writes the audit row in the
 * user's name. An inspection of several PO parts goes as a whole
 * (submitParts).
 */
export async function submitInspection(input: unknown): Promise<SubmitResult> {
  let reviewPath: string;
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = SubmitRequestSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: "The request was not understood. Reload the page and try again." };
    const { inspectionId, dataHash, partIds } = parsed.data;

    const supabase = await createClient();
    const loaded = await loadCaptureInspection(supabase, inspectionId, { files: true });
    if (loaded.kind === "not_found") return { status: "error", message: FAILURE_MESSAGES.not_found };
    if (loaded.kind === "template_unreadable") {
      return { status: "error", message: "This inspection's template cannot be read. Ask an admin." };
    }
    const row = loaded.inspection;
    reviewPath = `/inspections/${row.id}/review`;

    const parts = await loadParts(supabase, row.id);
    if (!parts) return { status: "error", message: SUBMIT_FAILED };
    if (parts.length > 1 || partIds !== undefined) {
      const refused = await submitParts(supabase, auth.user, { row, dataHash, parts, partIds });
      if (refused) return refused;
    } else {
      // Submitted already (a second tap, or another device): the review is where to go.
      const check = checkPart(row, auth.user, dataHash);
      if (check.kind === "refused") return { status: "error", message: check.message };
      if (check.kind === "blocked") return blockedResult(check, []);
      if (check.kind === "ready") {
        const missed = await writePart(supabase, auth.user.id, check);
        if (missed) return { status: "error", message: missedMessage(missed, null) };
        if (row.template.aiReviewOnSubmit) await startReviewsOnSubmit([row.id]);
      }
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("[capture] submit failed", error);
    return { status: "error", message: SUBMIT_FAILED };
  }
  redirect(reviewPath);
}

type ReadyPart = { kind: "ready"; row: CaptureInspection; columns: MirroredColumns };
type BlockedPart = { kind: "blocked"; errors: ValidationIssue[]; overrides: ModuleOverrides };

/** What submit makes of an inspection, or of one PO part of it. */
type PartCheck = { kind: "submitted" } | { kind: "refused"; message: string } | BlockedPart | ReadyPart;

/**
 * The checks submit runs on an inspection, and on each PO part of one: a
 * draft or reopened inspection the user may change, whose saved data is
 * exactly what the inspector validated (`dataHash`; null for a part that is
 * not on screen, which goes as saved) and has no errors. Ready, it carries
 * the columns the data mirrors, written again with the status.
 */
function checkPart(row: CaptureInspection, user: Submitter, dataHash: string | null): PartCheck {
  if (row.status === "submitted") return { kind: "submitted" };
  const access = captureAccess({
    status: row.status,
    role: user.role,
    userId: user.id,
    inspectorId: row.inspectorId,
  });
  if (!access.editable) return { kind: "refused", message: readOnlyMessage(row) };

  if (dataHash !== null && contentHash(row.data) !== dataHash) {
    return {
      kind: "refused",
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
  if (errors.length > 0) return { kind: "blocked", errors, overrides: row.overrides };
  return { kind: "ready", row, columns: mirroredColumns(evaluation) };
}

/** Blocked by the errors on screen, naming the other parts that need work too. */
function blockedResult(check: BlockedPart, others: readonly SubmitPartProblem[]): SubmitResult {
  const message = blockedSubmitMessage(neededSectionCount(check.errors));
  const too = others.length > 0 ? ` ${joinWords(others.map((part) => part.label))} ${others.length === 1 ? "needs" : "need"} work too.` : "";
  return { status: "blocked", message: `${message}${too}`, errors: check.errors, overrides: check.overrides };
}

/** Why a checked inspection was not written: the database refused it (its code), or it changed in between. */
type WriteMiss = { kind: "refused"; code: string | undefined } | { kind: "changed" };

/** Submits a checked inspection at the version it was checked at; null once it is written. */
async function writePart(supabase: Client, actorId: string, ready: ReadyPart): Promise<WriteMiss | null> {
  const written = await submitInspectionRow(supabase, serverWriter(actorId), {
    inspectionId: ready.row.id,
    // Unchanged since it was validated.
    baseUpdatedAt: ready.row.updatedAt,
    columns: ready.columns,
  });
  if ("error" in written) {
    console.error("[capture] submit refused", written.error.code, written.error.message);
    return { kind: "refused", code: written.error.code };
  }
  return written.submitted ? null : { kind: "changed" };
}

/** A write that missed, in words: of "this inspection", or of the PO part `label`. */
function missedMessage(missed: WriteMiss, label: string | null): string {
  const subject = label ?? "This inspection";
  if (missed.kind === "changed") return `${subject} changed while it was being submitted. Reload the page, then submit again.`;
  if (missed.code === "42501") return `You cannot submit ${label ?? "this inspection"}.`;
  if (missed.code === "23514") return `${subject} cannot be submitted from its current status. Reload the page.`;
  return label ? `${label} could not be submitted. Try again in a moment.` : SUBMIT_FAILED;
}

/* ------------------------------------------------------------------ *
 * Several PO parts
 * ------------------------------------------------------------------ */

type PartsRequest = {
  row: CaptureInspection;
  dataHash: string;
  parts: InspectionPart[];
  /** The parts the confirmation named; undefined from a screen that did not name them. */
  partIds: string[] | undefined;
};

type CheckedPart = { label: string; ready: ReadyPart | null; problem: SubmitPartProblem | null };

/**
 * Submits every PO part of the inspection the part on screen belongs to
 * (lib/inspections/parts.ts; Kenneth, 11 October 2026). Each part passes the
 * checks one inspection does (checkPart): the part on screen with the data
 * the inspector validated, the others as saved. A part submitted already,
 * or approved, is past submit and left as it is. While any part is refused
 * or has errors nothing is submitted, and the answer names each such PO to
 * link to. Then the parts go one by one through the same write as one
 * inspection, each with its own audit row and AI second opinion, the part on
 * screen last: should a write fail on the way, the parts before it stay
 * submitted (left as they are the next time) and this screen can still
 * submit again. Answers null once every part is submitted.
 */
async function submitParts(
  supabase: Client,
  user: Submitter,
  { row, dataHash, parts, partIds }: PartsRequest,
): Promise<SubmitResult | null> {
  if (partIds !== undefined && !sameParts(parts, partIds.map((id) => ({ id })))) {
    return {
      status: "error",
      message: "The POs of this inspection changed on another device. Reload the page to see them, then submit.",
    };
  }
  const own = checkPart(row, user, dataHash);
  if (own.kind === "refused") return { status: "error", message: own.message };

  const others = await Promise.all(
    parts.flatMap((part, index) => (part.id === row.id ? [] : [checkOtherPart(supabase, user, part, partLabel(part, index))])),
  );
  const problems = others.flatMap((other) => (other.problem ? [other.problem] : []));
  if (own.kind === "blocked") return blockedResult(own, problems);
  if (problems.length > 0) {
    return {
      status: "error",
      message: `Nothing was submitted: ${joinWords(problems.map((problem) => problem.label))} ${isOrAre(problems.length)} not ready yet.`,
      parts: problems,
    };
  }

  const ownIndex = parts.findIndex((part) => part.id === row.id);
  const queue = others.flatMap((other) => (other.ready ? [{ label: other.label, ready: other.ready }] : []));
  if (own.kind === "ready") queue.push({ label: ownIndex >= 0 ? partLabel(parts[ownIndex], ownIndex) : row.refNo, ready: own });

  const submitted: typeof queue = [];
  let missed: { label: string; miss: WriteMiss } | null = null;
  for (const item of queue) {
    const miss = await writePart(supabase, user.id, item.ready);
    if (miss) {
      missed = { label: item.label, miss };
      break;
    }
    submitted.push(item);
  }
  // Each part submitted keeps its own second opinion, also when a later one was not written.
  await startReviewsOnSubmit(submitted.filter((item) => item.ready.row.template.aiReviewOnSubmit).map((item) => item.ready.row.id));
  if (!missed) return null;
  const before = submitted.length > 0 ? `${joinWords(submitted.map((item) => item.label))} ${isOrAre(submitted.length)} submitted. ` : "";
  return { status: "error", message: `${before}${missedMessage(missed.miss, missed.label)}` };
}

/** checkPart for a part that is not on screen, as saved. A problem names the PO, to link to. */
async function checkOtherPart(supabase: Client, user: Submitter, part: InspectionPart, label: string): Promise<CheckedPart> {
  const problem = (message: string): CheckedPart => ({ label, ready: null, problem: { id: part.id, label, message } });
  const loaded = await loadCaptureInspection(supabase, part.id, { files: true });
  if (loaded.kind === "not_found") return problem(`${label} could not be found. Reload the page.`);
  if (loaded.kind === "template_unreadable") return problem(`The template of ${label} cannot be read. Ask an admin.`);
  // Approved on its own (an approve that stopped part way): past submit, like a submitted part.
  if (loaded.inspection.status === "approved") return { label, ready: null, problem: null };

  const check = checkPart(loaded.inspection, user, null);
  if (check.kind === "submitted") return { label, ready: null, problem: null };
  if (check.kind === "refused") return problem(`${label} can no longer be changed from this account.`);
  if (check.kind === "blocked") return problem(partNeedsMessage(neededSectionCount(check.errors), label));
  return { label, ready: check, problem: null };
}

/** How long submit waits for the AI review to start before it opens the review anyway. */
const AI_START_WAIT_MS = 3_000;

/**
 * The AI second opinion on submit, when the template asks for it (BUILD_SPEC
 * 9.2 "Trigger"): started once the inspection is submitted (each PO part,
 * for an inspection of several), as the service role (inspectors cannot
 * write ai_reviews). It never fails the submit and holds it up for
 * AI_START_WAIT_MS at most, all parts together: started by then, the review
 * shows it pending; otherwise it starts in the background all the same
 * (after() keeps the request alive for it). Nothing happens when no
 * reviewer is connected.
 */
async function startReviewsOnSubmit(inspectionIds: readonly string[]): Promise<void> {
  if (inspectionIds.length === 0) return;
  const started = Promise.all(
    inspectionIds.map((inspectionId) =>
      scheduleAiReviewOnSubmit(inspectionId).then(
        (result) => {
          if (!result.ok && result.reason !== "not_connected" && result.reason !== "pending") {
            console.error(`[capture] the AI second opinion did not start on submit: ${result.message}`);
          }
        },
        (error: unknown) => console.error("[capture] the AI second opinion did not start on submit", error),
      ),
    ),
  );
  after(() => started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, AI_START_WAIT_MS);
  });
  await Promise.race([started, waited]);
  clearTimeout(timer);
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
      const problem = switchOffProblem(row.template.resolved, row.overrides, moduleKey);
      if (problem) return { problem };
      return {
        next: withOverride(row.overrides, moduleKey, { reason, by: auth.user.id, at: new Date().toISOString() }),
        event: { module: moduleKey, include: false, reason },
        message: `${titleOf(row, moduleKey)} is switched off for this inspection.`,
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
      const problem = switchOnProblem(row.template.resolved, row.overrides, moduleKey);
      if (problem) return { problem };
      return {
        next: withoutOverride(row.overrides, moduleKey),
        event: { module: moduleKey, include: true, previousReason: row.overrides[moduleKey]?.reason ?? null },
        message: `${titleOf(row, moduleKey)} is switched back on.`,
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

function titleOf(row: CaptureInspection, key: string): string {
  return row.template.resolved.modules.find((entry) => entry.key === key)?.title ?? key;
}

function readOnlyMessage(row: Pick<CaptureInspection, "status">): string {
  if (row.status === "approved") return "This inspection is approved and can no longer be changed.";
  if (!isEditableStatus(row.status)) return "This inspection has been submitted and can no longer be changed here.";
  return "This inspection can no longer be changed from this account.";
}
