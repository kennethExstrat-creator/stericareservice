"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { saveSummarySettings } from "@/lib/ai/settings";
import { authorizeAction } from "@/lib/auth/session";
import { loadSummaryRecord, runSummary } from "@/lib/inspections/ai/summary-runner";
import {
  SUMMARY_MESSAGES,
  SummaryPreviewInputSchema,
  SummarySettingsInputSchema,
  type SummaryPreviewResult,
} from "@/lib/schemas/summary-style";
import { createClient } from "@/lib/supabase/server";

/*
 * Steri-AI Settings > Inspection Settings, the Inspection Summary card
 * (docs/AI.md, "Steri-AI Summary"; 12 October 2026). Public endpoints:
 * each checks for an active admin first and reads its input with zod (it
 * comes from the browser). The ai_settings row is the service role's only,
 * so the role is checked before anything is read or saved.
 */

/** How a save went (the card's ResultAlert), and each refused field's reason by its path ("style.closingSentence"). */
export type SummarySettingsSave = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

function fieldErrorsOf(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[issue.path.map(String).join(".")] ??= issue.message;
  return errors;
}

/**
 * Saves the card: the Inspection Summary's model and house style. A style
 * equal to the app's own is stored as null. Who saved it and when are kept
 * on the settings row, as for every Steri-AI setting (audit_log holds
 * inspection events only); only the last save is kept.
 */
export async function saveSummarySettingsAction(input: unknown): Promise<SummarySettingsSave> {
  const auth = await authorizeAction({ permission: "ai_settings" });
  if (!auth.ok) return { ok: false, message: auth.error };
  const parsed = SummarySettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const result = await saveSummarySettings(parsed.data, auth.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/admin/ai");
  return { ok: true, message: "Summary settings saved. The next summary uses them." };
}

/**
 * Try It: one real Steri-AI call on an inspection the admin can read, any
 * status, written with the card's unsaved model and style. Nothing is
 * written to the inspection, so no audit row; the call is recorded in
 * Steri-AI Cost as inspection_summary, with the admin as the actor.
 */
export async function previewSummaryAction(input: unknown): Promise<SummaryPreviewResult> {
  try {
    const auth = await authorizeAction({ permission: "ai_settings" });
    if (!auth.ok) return { ok: false, reason: "forbidden", message: auth.error };
    const parsed = SummaryPreviewInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, reason: "error", message: "Check the settings above: Try It uses them as they are on the card." };
    }
    const { inspectionId, model, style } = parsed.data;

    const loaded = await loadSummaryRecord(await createClient(), inspectionId);
    if (!loaded.ok) return loaded;
    const run = await runSummary({ record: loaded.record, options: { mode: "write", note: "" }, actorId: auth.user.id, override: { model, style } });
    if (!run.ok) return run;
    const { doc, text, notes, figures, words, model: answeredBy } = run.draft;
    return { ok: true, doc, text, notes, figures, words, model: answeredBy };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[steri-ai summary] previewSummaryAction failed", error);
    return { ok: false, reason: "error", message: SUMMARY_MESSAGES.failed };
  }
}
