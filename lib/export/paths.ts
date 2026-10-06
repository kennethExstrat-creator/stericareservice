/* ------------------------------------------------------------------ *
 * Where the export is served and what the download is called. Safe on
 * the client: the review panel links to the route.
 * ------------------------------------------------------------------ */

/** GET returns the export as a JSON download (app/api/inspections/[id]/export/route.ts). */
export function exportPath(inspectionId: string): string {
  return `/api/inspections/${encodeURIComponent(inspectionId)}/export`;
}

/** `INS-2026-0012-export.json`: ASCII only, safe in a Content-Disposition header. */
export function exportFileName(refNo: string): string {
  const safe = refNo.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "inspection"}-export.json`;
}
