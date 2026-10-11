import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { buildInspectionExport, exportFileName, parseInspectionId, type ExportFailureReason } from "@/lib/export";
import { createClient } from "@/lib/supabase/server";

/*
 * GET /api/inspections/[id]/export (BUILD_SPEC 9.1): the inspection export as
 * a JSON download, for its inspector or an admin. For an inspection of
 * several POs, any part's id gives the whole inspection's export: the first
 * part's, with the other parts in `parts`, named after the first part's
 * reference number.
 *
 *   401  not signed in
 *   403  signed in, but the account is not active
 *   404  no such inspection, or not one this account may export, part by part
 *        (the two look the same, so the route never reveals that someone
 *        else's exists)
 *   500  the inspection could not be turned into a valid export
 *   503  Supabase not configured, or the database or storage did not answer
 *
 * proxy.ts lets /api through without redirecting; this handler checks the
 * session itself, reads through the signed-in user's client (Row Level
 * Security) and checks owner-or-admin again on every part's record.
 */

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export async function GET(_request: NextRequest, context: RouteContext<"/api/inspections/[id]/export">) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (error) {
    console.error("[export] could not read the session", error);
    return failure(503, "unavailable", "The account could not be checked. Try again.");
  }
  switch (session.status) {
    case "unconfigured":
      return failure(503, "unavailable", "Supabase is not configured yet.");
    case "signed-out":
      return failure(401, "unauthorized", "Sign in to download the export.");
    case "deactivated":
      return failure(403, "forbidden", "This account is not active.");
    case "active":
      break;
  }

  const { id } = await context.params;
  const inspectionId = parseInspectionId(id);
  if (!inspectionId) return failure(404, "not_found", "Inspection not found.");

  const supabase = await createClient();
  const result = await buildInspectionExport(supabase, inspectionId, {
    viewer: { id: session.user.id, role: session.user.role },
  });
  if (!result.ok) {
    const [status, code] = FAILURE_STATUS[result.reason];
    return failure(status, code, result.message);
  }

  return new Response(`${JSON.stringify(result.export, null, 2)}\n`, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(result.export.refNo)}"`,
    },
  });
}

const FAILURE_STATUS: Readonly<Record<ExportFailureReason, readonly [number, string]>> = {
  not_found: [404, "not_found"],
  database_error: [503, "unavailable"],
  storage_error: [503, "unavailable"],
  unreadable_template: [500, "export_failed"],
  unreadable_data: [500, "export_failed"],
  invalid_export: [500, "export_failed"],
};

function failure(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status, headers: NO_STORE });
}
