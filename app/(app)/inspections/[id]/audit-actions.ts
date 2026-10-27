"use server";

// The capture screen's Audit Log page (Kenneth, 26 October 2026): the
// inspection's audit_log rows, newest first, in plain words
// (lib/inspections/capture/audit-log.ts). A public endpoint like every
// Server Action: it checks the session, then reads with the user's own
// client, so row level security decides who sees the rows: anyone who can
// open the inspection (its inspector, their lead, an admin).
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { authorizeAction } from "@/lib/auth/session";
import { auditLogEntries, type AuditLogEntry } from "@/lib/inspections/capture/audit-log";
import { personLabel } from "@/lib/inspections/format";
import { humanise, type AuditRow } from "@/lib/inspections/review/audit";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import { createClient } from "@/lib/supabase/server";

export type AuditLogResult = { status: "ok"; entries: AuditLogEntry[] } | { status: "error"; message: string };

const IdSchema = z.uuid();
const AUDIT_SELECT = "id, action, changes, at, actor_id, actor:profiles(full_name, email)";
/** The page shows the latest rows: an inspection's whole life is far fewer. */
const MOST_ROWS = 500;
const NOT_AVAILABLE = "That inspection is not available.";
const READ_FAILED = "The audit log could not be read. Try again.";

export async function loadAuditLog(inspectionId: string): Promise<AuditLogResult> {
  try {
    const auth = await authorizeAction();
    if (!auth.ok) return { status: "error", message: auth.error };
    if (!IdSchema.safeParse(inspectionId).success) return { status: "error", message: NOT_AVAILABLE };

    const supabase = await createClient();
    const [inspection, rows] = await Promise.all([
      supabase
        .from("inspections")
        .select("id, inspector_id, inspector:profiles!inspections_inspector_id_fkey(full_name, email), template:templates(resolved)")
        .eq("id", inspectionId)
        .maybeSingle(),
      supabase
        .from("audit_log")
        .select(AUDIT_SELECT)
        .eq("inspection_id", inspectionId)
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MOST_ROWS),
    ]);
    if (inspection.error || rows.error) {
      console.error("[audit log] reading failed", inspection.error?.message ?? rows.error?.message);
      return { status: "error", message: READ_FAILED };
    }
    if (!inspection.data) return { status: "error", message: NOT_AVAILABLE };

    const template = ResolvedTemplateSchema.safeParse(inspection.data.template?.resolved);
    const titles = new Map<string, string>(template.success ? template.data.modules.map((module) => [module.key, module.title]) : []);
    const audit: AuditRow[] = (rows.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      changes: row.changes,
      at: row.at,
      actorId: row.actor_id,
      actor: row.actor,
    }));
    const entries = auditLogEntries(audit, {
      people: {
        viewerId: auth.user.id,
        viewerName: personLabel({ full_name: auth.user.fullName, email: auth.user.email }) ?? "You",
        inspectorId: inspection.data.inspector_id,
        inspectorName: personLabel(inspection.data.inspector) ?? "the inspector",
      },
      moduleTitle: (key) => titles.get(key) ?? humanise(key),
      sizes: template.success ? template.data.sizes : undefined,
    });
    return { status: "ok", entries };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[audit log] failed", error);
    return { status: "error", message: READ_FAILED };
  }
}
