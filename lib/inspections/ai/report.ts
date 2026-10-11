import "server-only";
import { getAiStatus, reportNotConnectedMessage, requestAiReport, type AiReportOutcome } from "@/lib/ai";
import {
  exportOfParts,
  exportPath,
  loadInspectionParts,
  type ExportClient,
  type ExportViewer,
  type PartRecord,
} from "@/lib/export";
import { partLabel } from "@/lib/inspections/parts";
import type { InspectionExport } from "@/lib/schemas/export";
import { logInspectionEvent } from "./audit";
import { AI_STATUSES, NOT_REPORTABLE } from "./panel-model";

/* ------------------------------------------------------------------ *
 * "Send to AI Report" (BUILD_SPEC 9.1): the export of a submitted or
 * approved inspection goes to the report service, and the URL it answers
 * with is stored in inspections.report_url. Without a report service the
 * admin gets "AI Not Connected" and the JSON download instead.
 *
 * An inspection of several POs makes one report (Kenneth, 11 October
 * 2026): its whole export goes out, the other parts in `parts`, whichever
 * part's review it is sent from, once every part is submitted or
 * approved. The link is stored on every part, and the event logged on
 * each, so every part's review shows the report.
 * ------------------------------------------------------------------ */

export type SendReportResult =
  | { ok: true; reportUrl: string }
  | { ok: false; reason: "not_connected"; message: string; downloadHref: string }
  | { ok: false; reason: "not_found" | "not_reportable" | "export_failed" | "report_failed" | "database_error"; message: string };

export type SendReportInput = {
  /** The admin's own client: RLS and the inspection guard check the report_url write again. */
  client: ExportClient;
  inspectionId: string;
  viewer: ExportViewer;
  /** For tests: the report service call. */
  send?: (doc: InspectionExport) => Promise<AiReportOutcome>;
};

export async function sendInspectionToAiReport(input: SendReportInput): Promise<SendReportResult> {
  const { client, inspectionId, viewer } = input;
  const status = getAiStatus().report;
  if (!status.connected) {
    return {
      ok: false,
      reason: "not_connected",
      message: reportNotConnectedMessage(status),
      // The route gives any part's id the whole inspection's export.
      downloadHref: exportPath(inspectionId),
    };
  }

  const loaded = await loadInspectionParts(client, inspectionId, { viewer });
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason === "not_found" ? "not_found" : "database_error", message: loaded.message };
  }
  const { parts } = loaded;
  const waiting = notReportable(parts);
  if (waiting) return { ok: false, reason: "not_reportable", message: waiting };

  const built = await exportOfParts(client, parts.map(({ record }) => record));
  if (!built.ok) return { ok: false, reason: "export_failed", message: built.message };

  const outcome = await (input.send ?? requestAiReport)(built.export);
  if (!outcome.ok) {
    await logOnEveryPart(client, parts, "ai_report.failed", { reason: outcome.reason });
    return { ok: false, reason: "report_failed", message: `The AI report was not made. ${outcome.message}` };
  }

  // Admins may set report_url on an approved inspection too (the inspection guard allows it).
  const ids = parts.map(({ record }) => record.id);
  const { data, error } = await client
    .from("inspections")
    .update({ report_url: outcome.reportUrl })
    .in("id", ids)
    .select("id");
  if (error || (data?.length ?? 0) < ids.length) {
    console.error("[ai report] the report link could not be stored", {
      code: error?.code,
      message: error?.message,
      stored: data?.length ?? 0,
      parts: ids.length,
    });
    return {
      ok: false,
      reason: "database_error",
      message: `The report was made but its link could not be saved. Open it here: ${outcome.reportUrl}`,
    };
  }
  await logOnEveryPart(client, parts, "ai_report.sent", { reportUrl: outcome.reportUrl });
  return { ok: true, reportUrl: outcome.reportUrl };
}

/**
 * Why the inspection cannot go to the AI report yet, or null when it can:
 * every part must be submitted or approved, as the report covers them all.
 */
function notReportable(parts: readonly PartRecord[]): string | null {
  const index = parts.findIndex(({ record }) => !AI_STATUSES.includes(record.status));
  if (index === -1) return null;
  if (parts.length === 1) return NOT_REPORTABLE;
  return `The AI report covers every PO of this inspection, and ${partLabel(parts[index].part, index)} is not submitted or approved.`;
}

/** The event in each part's history, with the version of that part it was about. */
async function logOnEveryPart(
  client: ExportClient,
  parts: readonly PartRecord[],
  action: "ai_report.sent" | "ai_report.failed",
  changes: Record<string, unknown>,
): Promise<void> {
  const refNos = parts.length > 1 ? { parts: parts.map(({ record }) => record.refNo) } : {};
  await Promise.all(
    parts.map(({ record }) =>
      logInspectionEvent(client, record.id, action, { ...changes, inspectionUpdatedAt: record.updatedAt, ...refNos }),
    ),
  );
}
