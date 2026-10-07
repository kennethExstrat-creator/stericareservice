import "server-only";
import { getAiStatus, reportNotConnectedMessage, requestAiReport, type AiReportOutcome } from "@/lib/ai";
import {
  canExportInspection,
  evaluateRecord,
  exportFromEvaluation,
  exportPath,
  loadInspectionRecord,
  type ExportClient,
  type ExportViewer,
} from "@/lib/export";
import type { InspectionExport } from "@/lib/schemas/export";
import { logInspectionEvent } from "./audit";
import { AI_STATUSES, NOT_REPORTABLE } from "./panel-model";

/* ------------------------------------------------------------------ *
 * "Send to AI Report" (BUILD_SPEC 9.1): the export of a submitted or
 * approved inspection goes to the report service, and the URL it answers
 * with is stored in inspections.report_url. Without a report service the
 * admin gets "AI Not Connected" and the JSON download instead.
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
      downloadHref: exportPath(inspectionId),
    };
  }

  const loaded = await loadInspectionRecord(client, inspectionId);
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason === "not_found" ? "not_found" : "database_error", message: loaded.message };
  }
  const { record } = loaded;
  if (!canExportInspection(viewer, record)) return { ok: false, reason: "not_found", message: "Inspection not found." };
  if (!AI_STATUSES.includes(record.status)) return { ok: false, reason: "not_reportable", message: NOT_REPORTABLE };

  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) return { ok: false, reason: "export_failed", message: evaluation.message };
  const built = await exportFromEvaluation(client, record, evaluation.evaluated);
  if (!built.ok) return { ok: false, reason: "export_failed", message: built.message };

  const outcome = await (input.send ?? requestAiReport)(built.export);
  if (!outcome.ok) {
    await logInspectionEvent(client, record.id, "ai_report.failed", {
      reason: outcome.reason,
      inspectionUpdatedAt: record.updatedAt,
    });
    return { ok: false, reason: "report_failed", message: `The AI report was not made. ${outcome.message}` };
  }

  // Admins may set report_url on an approved inspection too (the inspection guard allows it).
  const { data, error } = await client
    .from("inspections")
    .update({ report_url: outcome.reportUrl })
    .eq("id", record.id)
    .select("id");
  if (error || !data?.length) {
    console.error("[ai report] the report link could not be stored", { code: error?.code, message: error?.message });
    return {
      ok: false,
      reason: "database_error",
      message: `The report was made but its link could not be saved. Open it here: ${outcome.reportUrl}`,
    };
  }
  await logInspectionEvent(client, record.id, "ai_report.sent", {
    reportUrl: outcome.reportUrl,
    inspectionUpdatedAt: record.updatedAt,
  });
  return { ok: true, reportUrl: outcome.reportUrl };
}
