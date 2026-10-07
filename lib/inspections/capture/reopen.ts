// Why a reopened inspection came back to its inspector (BUILD_SPEC 5: an
// admin reopens a submitted inspection from the review). The reopen is an
// audit row status_changed to reopened; the admin's reason is the
// review.reopened event logged right after it. The capture screen says who
// reopened it, when, and what to change, in the review's own words
// (lib/inspections/review/notice.ts), so both screens tell it the same way.
// Inspectors may read the audit rows of their own inspections (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KnownPeople } from "@/lib/inspections/review/actor";
import { buildAuditTrail, type AuditRow } from "@/lib/inspections/review/audit";
import { statusNotice } from "@/lib/inspections/review/notice";
import { REOPEN_EVENT } from "@/lib/inspections/review/schemas";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** What the screen shows about the reopen: a heading, who and when, and the admin's reason under its label. */
export type ReopenNote = {
  title: string;
  body: string;
  reason: { label: string; text: string } | null;
};

const AUDIT_SELECT = "id, action, changes, at, actor_id, actor:profiles(full_name, email)";

type AuditSelectRow = {
  id: number;
  action: string;
  changes: unknown;
  at: string;
  actor_id: string | null;
  actor: { full_name: string | null; email: string | null } | null;
};

/** The note for a reopened inspection from its audit rows; null for any other status. */
export function reopenNote(
  status: string,
  rows: readonly AuditRow[],
  viewer: { id: string; role: "inspector" | "admin" },
  people: KnownPeople,
): ReopenNote | null {
  if (status !== "reopened") return null;
  const notice = statusNotice(
    {
      status: "reopened",
      inspector: { id: people.inspectorId, name: people.inspectorName },
      submittedAt: null,
      approvedAt: null,
      approver: null,
    },
    viewer,
    buildAuditTrail(rows, people),
  );
  return { title: notice.title, body: notice.body, reason: notice.reason };
}

/**
 * Reads the reopen behind a reopened inspection. A failed read leaves the
 * note out (the screen still says the inspection is editable); it never
 * stops the screen from opening.
 */
export async function loadReopenNote(
  client: Client,
  inspection: { id: string; status: string },
  viewer: { id: string; role: "inspector" | "admin" },
  people: KnownPeople,
): Promise<ReopenNote | null> {
  if (inspection.status !== "reopened") return null;
  const { data, error } = await client
    .from("audit_log")
    .select(AUDIT_SELECT)
    .eq("inspection_id", inspection.id)
    .in("action", ["status_changed", REOPEN_EVENT])
    .order("at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[capture] the reopen could not be read", error.code, error.message);
    return null;
  }
  const rows = (data as unknown as AuditSelectRow[]).map(
    (row): AuditRow => ({
      id: row.id,
      action: row.action,
      changes: row.changes,
      at: row.at,
      actorId: row.actor_id,
      actor: row.actor,
    }),
  );
  return reopenNote(inspection.status, rows, viewer, people);
}
