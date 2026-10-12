import "server-only";
import { loadSummarySetup } from "@/lib/ai/settings";
import { docToInlineText, stripHouseWording } from "@/lib/ai/summary-doc";
import { houseWordingOf } from "@/lib/ai/summary-style-text";
import { finalResultOf, resultWordsOf, summaryViewOf } from "@/lib/ai/summary-view";
import { writeSummary } from "@/lib/ai/summary-writer";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { evaluateRecord, loadInspectionRecord, type EvaluatedInspection, type ExportClient, type InspectionRecord } from "@/lib/export";
import { inspectionSummaryOf } from "@/lib/export/conclusion";
import { normaliseData } from "@/lib/inspections/capture/load";
import { summaryBasisHash, summaryTextHash } from "@/lib/inspections/capture/summary-basis";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import { contentHash } from "@/lib/offline/stable-json";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import {
  needsResultMessage,
  resolveSummaryStyle,
  SUMMARY_MESSAGES,
  type ParsedSummaryOptions,
  type SummaryDraftFailure,
  type SummaryDraftSuccess,
  type SummaryFailureReason,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { CONCLUSION_LABELS } from "@/modules/conclusion/config";

/* ------------------------------------------------------------------ *
 * The Steri-AI Summary on the server (docs/AI.md, "Steri-AI Summary";
 * 12 October 2026), shared by the inspector's draftInspectionSummary and
 * the admin's Try It (previewSummaryAction): read the inspection through
 * the caller's own client, so Row Level Security decides; work out its
 * results as the capture screen does; then ask Steri-AI for the summary in
 * the house style, the inspector's choices applied only as the style
 * allows. Each Claude call is recorded as inspection_summary (Steri-AI
 * Cost), only once the caller's checks have passed.
 *
 * Nothing here writes inspection data or a result: the draft goes back to
 * the screen, which inserts it through the editor and autosave, where
 * saveCaptureData checks it again.
 * ------------------------------------------------------------------ */

const fail = (reason: SummaryFailureReason, message: string): SummaryDraftFailure => ({ ok: false, reason, message });

export type SummaryRecordLoad = { ok: true; record: InspectionRecord } | SummaryDraftFailure;

/** The inspection, its photos and files, through `client`; one it may not read is "not available". */
export async function loadSummaryRecord(client: ExportClient, inspectionId: string): Promise<SummaryRecordLoad> {
  const loaded = await loadInspectionRecord(client, inspectionId);
  if (loaded.ok) return { ok: true, record: loaded.record };
  return loaded.reason === "not_found" ? fail("forbidden", SUMMARY_MESSAGES.notAvailable) : fail("error", loaded.message);
}

export type RunSummaryInput = {
  record: InspectionRecord;
  options: ParsedSummaryOptions;
  /** Who asked: the cost is recorded in their name. */
  actorId: string;
  /** Try It: the settings card's unsaved model and house style, in place of the saved ones. */
  override?: { model: string; style: SummaryStyle };
};

export type SummaryRun =
  | {
      ok: true;
      draft: SummaryDraftSuccess;
      /** The style the draft was written in. */
      style: SummaryStyle;
      /** 1, or 2 when the check retry wrote it. */
      attempts: number;
    }
  | SummaryDraftFailure;

/** The inspector's saved Inspection Summary, as the evaluation read the conclusion. */
function savedSummaryOf(evaluated: EvaluatedInspection) {
  const conclusion = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion");
  return inspectionSummaryOf(conclusion?.data);
}

/**
 * One summary of an inspection already read and allowed. Write needs the
 * conclusion (the summary starts with it); Polish needs text, and sends it
 * without the house wording it ends with, which goes back word for word.
 */
export async function runSummary(input: RunSummaryInput): Promise<SummaryRun> {
  const { record, options, actorId } = input;
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) return fail("error", SUMMARY_MESSAGES.unreadable);
  const { evaluated } = evaluation;

  const finalResult = finalResultOf(record, evaluated);
  if (options.mode === "write" && finalResult === null) return fail("needs_result", needsResultMessage(resultWordsOf(evaluated)));
  const saved = options.mode === "polish" ? savedSummaryOf(evaluated) : null;
  if (options.mode === "polish" && saved === null) return fail("error", SUMMARY_MESSAGES.nothingToPolish);

  // The server applies the lock and the offered languages again: the menu's choices are never trusted.
  const setup = await loadSummarySetup();
  const env = input.override ? { ...setup.env, AI_SUMMARY_MODEL: input.override.model } : setup.env;
  const style = resolveSummaryStyle(input.override?.style ?? setup.style, options);

  let houseWording = houseWordingOf(style, finalResult);
  let draft: string | null = null;
  if (saved) {
    const stripped = stripHouseWording(saved, houseWording);
    draft = docToInlineText(stripped.doc).trim();
    houseWording = stripped.wording;
    if (draft === "") return fail("error", SUMMARY_MESSAGES.nothingToPolish);
  }

  const usage = { feature: "inspection_summary" as const, inspectionId: record.id, actorId };
  const outcome = await writeSummary(
    { view: summaryViewOf({ record, evaluated }), style, mode: options.mode, note: options.note, draft, finalResult, houseWording },
    env,
    // A draft counts one summary; its check retry is a call but no extra summary.
    { onCall: recordAiUsageLater({ ...usage, itemCount: 1 }), onRetryCall: recordAiUsageLater({ ...usage, itemCount: 0 }) },
  );
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    draft: {
      ok: true,
      mode: options.mode,
      doc: outcome.doc,
      text: outcome.text,
      notes: outcome.notes,
      figures: outcome.figures,
      words: outcome.words,
      model: outcome.model,
      basis: summaryBasisHash(normaliseData(record.data)),
    },
    style,
    attempts: outcome.attempts,
  };
}

/**
 * summary_drafted's record: the choices the draft was written with and its
 * hashes; never the text, the note or the inspector's draft. Whether the
 * inspector inserted it shows in the data save's own audit row.
 */
export function summaryDraftedChanges(by: string, run: Extract<SummaryRun, { ok: true }>, options: ParsedSummaryOptions): Record<string, Json> {
  const { draft, style } = run;
  return {
    by,
    model: draft.model,
    mode: draft.mode,
    length: style.length,
    paragraphs: style.paragraphs,
    format: style.format,
    language: style.language,
    note: options.note !== "",
    words: draft.words,
    attempts: run.attempts,
    style_hash: contentHash(style),
    text_hash: summaryTextHash(draft.text),
    basis_hash: draft.basis,
  };
}

/**
 * Records summary_drafted in the inspection's audit log with the secret key,
 * `by` naming who: an inspector may record only a few events themselves.
 * The draft is written either way, so a failed record is only logged.
 */
export async function logSummaryDrafted(inspectionId: string, changes: Record<string, Json>): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("log_inspection_event", {
      inspection_id: inspectionId,
      action: "summary_drafted",
      changes,
    });
    if (error) console.error("[steri-ai summary] could not record summary_drafted", error.code, error.message);
  } catch (error) {
    console.error("[steri-ai summary] could not record summary_drafted", error);
  }
}

/** One inspection Try It can run on. */
export type SummaryPreviewTarget = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  result: InspectionResult;
  /** "INS-2026-2192 · Draft · PASSED". */
  label: string;
};

/**
 * Try It's choices: the inspections the admin can read (their own client)
 * with a conclusion, most recently updated first. One without a conclusion
 * would only answer that it needs one, as the inspector's button does.
 */
export async function loadSummaryPreviewTargets(client: ExportClient, limit = 10): Promise<SummaryPreviewTarget[]> {
  const { data, error } = await client
    .from("inspections")
    .select("id, ref_no, status, result")
    .not("result", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[steri-ai summary] reading Try It's inspections failed", error.code, error.message);
    return [];
  }
  return data.flatMap((row) =>
    row.result
      ? [
          {
            id: row.id,
            refNo: row.ref_no,
            status: row.status,
            result: row.result,
            label: `${row.ref_no} · ${INSPECTION_STATUS_LABEL[row.status]} · ${CONCLUSION_LABELS[row.result]}`,
          },
        ]
      : [],
  );
}
