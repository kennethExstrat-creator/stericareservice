"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { loadSummaryRecord, logSummaryDrafted, runSummary, summaryDraftedChanges } from "@/lib/inspections/ai/summary-runner";
import { captureAccess } from "@/lib/inspections/capture/access";
import { normaliseData } from "@/lib/inspections/capture/load";
import { DataHashSchema } from "@/lib/inspections/capture/schemas";
import { contentHash } from "@/lib/offline/stable-json";
import { SUMMARY_MESSAGES, SummaryOptionsSchema, type SummaryDraftResult } from "@/lib/schemas/summary-style";
import { createClient } from "@/lib/supabase/server";

/*
 * The Steri-AI Summary button on the Conclusion (docs/AI.md, "Steri-AI
 * Summary"; 12 October 2026). A public endpoint, so it checks the session,
 * validates its input with zod, reads the inspection through the user's own
 * client (Row Level Security decides) and allows only who may change it on
 * the capture screen (captureAccess: the inspector or an admin, while it is
 * a draft or reopened; the autosave that saves the summary keeps the same
 * rule). Leads and submitted or approved inspections never reach Claude.
 * The saved data must be what the screen holds (`dataHash`, after its
 * autosave flush), so the draft is written from what the inspector sees.
 *
 * It answers a document and never writes inspection data or a result: the
 * screen inserts the draft through the editor and autosave. Each draft is
 * recorded as summary_drafted, without its text.
 */

const SummaryRequestSchema = z.strictObject({
  inspectionId: z.uuid(),
  dataHash: DataHashSchema,
  options: SummaryOptionsSchema,
});

export async function draftInspectionSummary(input: unknown): Promise<SummaryDraftResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, reason: "forbidden", message: auth.error };

    const parsed = SummaryRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "error", message: SUMMARY_MESSAGES.notUnderstood };
    const { inspectionId, dataHash, options } = parsed.data;

    const supabase = await createClient();
    const loaded = await loadSummaryRecord(supabase, inspectionId);
    if (!loaded.ok) return loaded;
    const { record } = loaded;

    const access = captureAccess({ status: record.status, role: auth.user.role, userId: auth.user.id, inspectorId: record.inspectorId });
    if (!access.editable) return { ok: false, reason: "forbidden", message: SUMMARY_MESSAGES.readOnly };
    if (contentHash(normaliseData(record.data)) !== dataHash) return { ok: false, reason: "changed", message: SUMMARY_MESSAGES.changed };

    const run = await runSummary({ record, options, actorId: auth.user.id });
    if (!run.ok) return run;
    await logSummaryDrafted(record.id, summaryDraftedChanges(auth.user.id, run, options));
    return run.draft;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[steri-ai summary] draftInspectionSummary failed", error);
    return { ok: false, reason: "error", message: SUMMARY_MESSAGES.failed };
  }
}
