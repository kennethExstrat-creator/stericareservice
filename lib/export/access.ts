/* ------------------------------------------------------------------ *
 * Who may export an inspection (BUILD_SPEC 9.1): its inspector, the lead
 * inspector whose team they are in (Kenneth, 27 October 2026: "Can lead
 * inspectors download reports?" "Yes"), or an admin. Row Level Security
 * lets the same people read it through the user's client; this is the
 * app's own check on top, made from who the inspector and their lead are,
 * never from what a read returned (some callers read with the secret key).
 * Taking the export away, Download PDF (the print route) and the export
 * route, is the role's Export Reports as well (lib/auth/permissions.ts),
 * which those check on top of this.
 *
 * A lead gets in only when both sides say so: the viewer's `isLead` and the
 * inspection's `inspectorLeadId`. Steri-AI (lib/inspections/ai: the panel,
 * the second opinion) passes the export record itself, which names the
 * inspector's lead inside `inspector` only, so Steri-AI stays with the
 * inspector and admins: Kenneth was asked about downloading.
 * ------------------------------------------------------------------ */

export type ExportViewer = {
  id: string;
  role: "inspector" | "admin";
  /** A lead inspector (SessionUser.isLead). Absent: not a lead. */
  isLead?: boolean;
};

export function canExportInspection(
  viewer: ExportViewer,
  inspection: {
    inspectorId: string;
    /** The inspector's lead inspector (profiles.lead_id). Null or absent: no lead may export it. */
    inspectorLeadId?: string | null;
  },
): boolean {
  if (viewer.role === "admin" || viewer.id === inspection.inspectorId) return true;
  return viewer.isLead === true && inspection.inspectorLeadId === viewer.id;
}
