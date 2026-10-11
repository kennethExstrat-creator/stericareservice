import "server-only";
import { captureAccess, type ReadOnlyReason } from "@/lib/inspections/capture/access";
import { changedEntryProblems } from "@/lib/inspections/capture/changes";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { loadCaptureInspection } from "@/lib/inspections/capture/load";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
import { serverWriter } from "@/lib/inspections/writes";
import { saveInspectionData } from "@/lib/offline";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { applyModuleOverrides, includedModules } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules";
import { applyProposals, type SourceProposals } from "./source-documents";
import { CLAIM_MS } from "./source-group";
import { partFacts } from "./source-parts";

/*
 * Source Documents across PO parts, on the server (docs/AI.md, "Source
 * Documents"). The part whose screen asked for a reading fills its own
 * values through that screen's autosave; every other part is filled here,
 * with the same pure applyProposals, and saved the way the capture save
 * saves (app/(app)/inspections/[id]/actions.ts saveCaptureData): read
 * through the caller's client, the changed entries checked, the mirrored
 * columns worked out, written with the secret key for the caller as a
 * compare-and-set on the version just read. A part that changed meanwhile
 * is left as it is and reported.
 *
 * A file is read once for all the parts: a reading claims it first
 * (ai_read_at set, no status yet), so a second screen asking meanwhile
 * waits for that reading instead of adding the same POs again.
 */

type Client = Awaited<ReturnType<typeof createClient>>;
type Actor = { id: string; role: "inspector" | "admin" };

/** The modules a part fills: its template's, less those switched off for it. */
export function partModules(template: ResolvedTemplate, overrides: ModuleOverrides): Set<string> {
  return new Set(includedModules(applyModuleOverrides(template, overrides)).map((module) => module.key));
}

export type ServerFill =
  /** `poNo`: the part's PO once filled, for its label. */
  | { kind: "filled"; filled: number; poNo: string | null }
  /** Left as it was: why, as the end of a sentence ("Skipped PO 2680279: it is submitted."). */
  | { kind: "skipped"; reason: string };

const LOCKED: Readonly<Record<ReadOnlyReason, string>> = {
  submitted: "it is submitted",
  approved: "it is approved",
  not_yours: "only its inspector or an admin can change it",
};

/** Fills a part's empty fields with a reading's proposals and saves it, while it is a draft or reopened. */
export async function fillPartOnServer(client: Client, user: Actor, partId: string, proposals: SourceProposals): Promise<ServerFill> {
  try {
    // With its files: the mirrored suggestion counts a lab report as the save does.
    const loaded = await loadCaptureInspection(client, partId, { files: true });
    if (loaded.kind === "not_found") return { kind: "skipped", reason: "it is not available" };
    if (loaded.kind === "template_unreadable") return { kind: "skipped", reason: "its template cannot be read" };
    const row = loaded.inspection;
    const access = captureAccess({ status: row.status, role: user.role, userId: user.id, inspectorId: row.inspectorId });
    if (!access.editable) return { kind: "skipped", reason: LOCKED[access.readOnlyReason] };

    const template = row.template.resolved;
    const { data, filled } = applyProposals(row.data, proposals, MODULE_REGISTRY, partModules(template, row.overrides));
    const poNo = partFacts(data).poNo;
    if (filled === 0) return { kind: "filled", filled: 0, poNo };
    if (changedEntryProblems(row.data, data, template).length > 0) return { kind: "skipped", reason: "a value did not fit its section" };

    const evaluation = evaluateCapture({ template, overrides: row.overrides, data, meta: row.meta });
    const saved = await saveInspectionData(
      client,
      { inspectionId: row.id, data, baseUpdatedAt: row.updatedAt },
      { columns: () => mirroredColumns(evaluation), writer: serverWriter(user.id) },
    );
    if (saved.ok) return { kind: "filled", filled, poNo };
    if (saved.reason === "conflict") return { kind: "skipped", reason: "it changed while AI was reading" };
    console.error("[source documents] saving a part failed", saved.reason, saved.message);
    return { kind: "skipped", reason: saved.reason === "forbidden" ? "it can no longer be changed" : "it could not be saved" };
  } catch (error) {
    console.error("[source documents] filling a part failed", error);
    return { kind: "skipped", reason: "it could not be saved" };
  }
}

/** A file's reading as it was before a claim, to give it back when no reading happens after all. */
export type StoredReading = { ai_status: string | null; ai_read_at: string | null; ai_summary: string | null };

export type FileClaim = { kind: "claimed" } | { kind: "busy" } | { kind: "read"; summary: string | null } | { kind: "error" };

/**
 * Claims a Source Document for one reading: one not read yet, one that
 * failed (Read Again), or one whose claim a reading that never finished left
 * behind. Another reading holding it: "busy"; read meanwhile: "read". Written
 * with the secret key once the caller is known to be allowed to edit.
 */
export async function claimFile(fileId: string): Promise<FileClaim> {
  const admin = createAdminClient();
  // Quoted: a timestamp holds PostgREST's reserved "." and ":".
  const stale = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data, error } = await admin
    .from("inspection_files")
    .update({ ai_status: null, ai_read_at: new Date().toISOString() })
    .eq("id", fileId)
    .or(`ai_status.eq.failed,and(ai_status.is.null,ai_read_at.is.null),and(ai_status.is.null,ai_read_at.lt."${stale}")`)
    .select("id");
  if (error) {
    console.error("[source documents] claiming the file failed", error.code, error.message);
    return { kind: "error" };
  }
  if (data.length > 0) return { kind: "claimed" };
  const now = await admin.from("inspection_files").select("ai_status, ai_summary").eq("id", fileId).maybeSingle();
  return now.data?.ai_status === "read" ? { kind: "read", summary: now.data.ai_summary } : { kind: "busy" };
}

/** Gives a claimed file back as it was: the AI was not connected, or the reading broke off. */
export async function releaseFile(fileId: string, before: StoredReading): Promise<void> {
  const { error } = await createAdminClient().from("inspection_files").update(before).eq("id", fileId).is("ai_status", null);
  if (error) console.error("[source documents] releasing the file failed", error.code, error.message);
}

/** Marks the file read or not, which ends the claim; a failure here is logged, the reading still counts. */
export async function recordReading(fileId: string, status: "read" | "failed", summary: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("inspection_files")
    .update({ ai_status: status, ai_read_at: new Date().toISOString(), ai_summary: summary.slice(0, 1000) })
    .eq("id", fileId);
  if (error) console.error("[source documents] recording the reading failed", error.code, error.message);
}
