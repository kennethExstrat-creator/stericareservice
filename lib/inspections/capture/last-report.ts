import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateTime } from "@/lib/inspections/ai/format";
import type { Database } from "@/lib/supabase/database.types";
import type { LastReport } from "./report";

/**
 * The report last made for an inspection, for the Report page's Open Last
 * Report (Kenneth, 27 October 2026): its link, inspections.report_url, and
 * when it was made, from the newest `ai_report.sent` audit row, which
 * sendInspectionToAiReport writes with each report it stores, while that row
 * names the same link. Read with the user's own client: whoever can open the
 * inspection reads both. Null without a link, or when it cannot be read: the
 * capture screen opens all the same.
 */
export async function loadLastReport(client: SupabaseClient<Database>, inspectionId: string): Promise<LastReport | null> {
  try {
    const [inspection, sent] = await Promise.all([
      client.from("inspections").select("report_url").eq("id", inspectionId).maybeSingle(),
      client
        .from("audit_log")
        .select("at, changes")
        .eq("inspection_id", inspectionId)
        .eq("action", "ai_report.sent")
        .order("at", { ascending: false })
        .limit(1),
    ]);
    if (inspection.error) {
      console.error("[capture] the report link could not be read", inspection.error.message);
      return null;
    }
    const url = inspection.data?.report_url ?? null;
    if (!url) return null;
    const last = sent.error ? null : (sent.data?.[0] ?? null);
    const changes: unknown = last?.changes;
    const made = last !== null && isRecord(changes) && changes.reportUrl === url;
    return { url, madeAt: made ? { iso: last.at, label: formatDateTime(last.at) } : null };
  } catch (error) {
    console.error("[capture] the last report could not be read", error);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
