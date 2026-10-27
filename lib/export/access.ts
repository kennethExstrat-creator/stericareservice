/* ------------------------------------------------------------------ *
 * Who may export an inspection (BUILD_SPEC 9.1): its inspector or an
 * admin. Row Level Security enforces the same rule when the record is
 * read through the user's client; this is the app's own check on top.
 * It is what someone sees, so the AI panel and the second opinion read
 * by it too. Taking the export away, the download (the export route) and
 * Send to Steri-AI Report, is the role's Export Reports as well
 * (lib/auth/permissions.ts), which those check on top of this.
 * ------------------------------------------------------------------ */

export type ExportViewer = { id: string; role: "inspector" | "admin" };

export function canExportInspection(viewer: ExportViewer, inspection: { inspectorId: string }): boolean {
  return viewer.role === "admin" || viewer.id === inspection.inspectorId;
}
