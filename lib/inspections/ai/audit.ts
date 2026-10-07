import "server-only";
import type { ExportClient } from "@/lib/export";
import type { Json } from "@/lib/supabase/database.types";

/** A value as plain JSON for a jsonb column: whatever JSON.stringify keeps. */
export function asJson(value: unknown): NonNullable<Json> {
  return JSON.parse(JSON.stringify(value ?? null) ?? "null") ?? {};
}

/**
 * Records an AI event in the inspection's audit log (log_inspection_event,
 * docs/DATABASE.md "Audit log"): as the signed-in admin, or with no actor for
 * the service role. The event is the trail, not the work: a failure to log is
 * reported in the server log and does not undo what was done.
 */
export async function logInspectionEvent(
  client: ExportClient,
  inspectionId: string,
  action: `ai_review.${string}` | `ai_report.${string}`,
  changes: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await client.rpc("log_inspection_event", {
      inspection_id: inspectionId,
      action,
      changes: asJson(changes),
    });
    if (error) console.error(`[ai] could not log ${action}`, { code: error.code, message: error.message });
  } catch (error) {
    console.error(`[ai] logging ${action} threw`, error);
  }
}
