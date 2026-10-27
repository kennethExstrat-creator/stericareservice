/* ------------------------------------------------------------------ *
 * What the export route's download is called
 * (app/api/inspections/[id]/export/route.ts).
 * ------------------------------------------------------------------ */

/** `INS-2026-0012-export.json`: ASCII only, safe in a Content-Disposition header. */
export function exportFileName(refNo: string): string {
  const safe = refNo.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "inspection"}-export.json`;
}
