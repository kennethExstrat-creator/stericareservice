import "server-only";
import { AiReportResponseSchema, ExportSchema, type InspectionExport } from "@/lib/schemas";
import { readAiConfig, type AiEnv } from "./config";
import { summarizeIssues } from "./issues";
import { AI_REPORT_NOT_CONNECTED } from "./status";
import type { AiReportOutcome } from "./types";
import { handoffFailureReason, postWebhook } from "./webhook";

/* ------------------------------------------------------------------ *
 * AI report hand-off (BUILD_SPEC 9.1): the export goes to the report
 * service, which answers with the URL of the finished report. Webhook
 * only; with no URL set the UI offers the JSON download instead.
 * ------------------------------------------------------------------ */

/** Writing a four-page report takes longer than a review. */
export const REPORT_WEBHOOK_TIMEOUT_MS = 180_000;

export interface RequestAiReportOptions {
  env?: AiEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/** Never throws: every failure comes back as { ok: false, reason, message }. */
export async function requestAiReport(
  exportDoc: InspectionExport,
  options: RequestAiReportOptions = {},
): Promise<AiReportOutcome> {
  try {
    return await sendReport(exportDoc, options);
  } catch (error) {
    console.error("[ai] Unexpected error while requesting an AI report", error);
    return { ok: false, reason: "error", message: "Unexpected error while requesting Steri-AI's report." };
  }
}

async function sendReport(exportDoc: InspectionExport, options: RequestAiReportOptions): Promise<AiReportOutcome> {
  const target = readAiConfig(options.env).report;
  if (target.provider === "off") {
    return { ok: false, reason: "not_connected", message: `${AI_REPORT_NOT_CONNECTED}.` };
  }
  if (target.provider === "misconfigured") {
    return { ok: false, reason: "misconfigured", message: target.problems.join(" ") };
  }

  const parsed = ExportSchema.safeParse(exportDoc);
  if (!parsed.success) {
    return { ok: false, reason: "error", message: `The inspection export is invalid (${summarizeIssues(parsed.error)}).` };
  }

  const result = await postWebhook({
    url: target.webhook.url,
    secret: target.webhook.secret,
    event: "ai.report.requested",
    payload: parsed.data,
    responseSchema: AiReportResponseSchema,
    timeoutMs: options.timeoutMs ?? REPORT_WEBHOOK_TIMEOUT_MS,
    fetch: options.fetch,
    signal: options.signal,
  });
  if (!result.ok) {
    return { ok: false, reason: handoffFailureReason(result.reason), message: result.message };
  }
  return { ok: true, reportUrl: result.data.reportUrl };
}
