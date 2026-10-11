import "server-only";
import type { InspectionPart } from "@/lib/inspections/parts";
import { loadParts } from "@/lib/inspections/parts-server";
import { canExportInspection, type ExportViewer } from "./access";
import { loadInspectionRecord, type ExportClient, type InspectionRecord } from "./record";

/* ------------------------------------------------------------------ *
 * An inspection's PO parts as the export reads them (lib/inspections/
 * parts.ts): every part of the inspection an id belongs to, each with its
 * record, the first part (which stands for the inspection) first and the
 * others in part order, as the screens list them (loadParts). Whichever
 * part is asked for, the export is the whole inspection's.
 *
 * Read through the client it is given, so Row Level Security decides
 * what the caller sees. With a viewer, the part asked for and every other
 * part must each be one they may export on its own (canExportInspection:
 * its inspector or an admin). The parts share their inspector, so this
 * only refuses an inspection whose parts disagree, and it never hands out
 * a part its viewer could not export by itself.
 * ------------------------------------------------------------------ */

/** One PO part: as the screens name it, and its record. */
export type PartRecord = { part: InspectionPart; record: InspectionRecord };

export type LoadPartsResult =
  /** `parts[0]` is the first part, the inspection itself; one entry when it covers one PO. */
  | { ok: true; parts: PartRecord[] }
  | { ok: false; reason: "not_found" | "database_error"; message: string };

export async function loadInspectionParts(
  client: ExportClient,
  inspectionId: string,
  options: { viewer?: ExportViewer } = {},
): Promise<LoadPartsResult> {
  const { viewer } = options;
  // The part asked for first, so nobody learns more about an inspection they may not export.
  const asked = await loadInspectionRecord(client, inspectionId);
  if (!asked.ok) return asked;
  if (viewer && !canExportInspection(viewer, asked.record)) return notFound();

  const listed = await loadParts(client, asked.record.id);
  if (!listed) return { ok: false, reason: "database_error", message: "Could not read the inspection's POs. Try again." };
  // Without its first part there is no inspection to export (Row Level Security hides it, or the group is broken).
  const first = listed.find((part) => part.primary);
  if (!first) return notFound();
  const ordered = [first, ...listed.filter((part) => part !== first)];

  const loaded = await Promise.all(
    ordered.map((part) => (part.id === asked.record.id ? asked : loadInspectionRecord(client, part.id))),
  );
  const parts: PartRecord[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const result = loaded[index];
    if (!result.ok) return result;
    if (viewer && !canExportInspection(viewer, result.record)) return notFound();
    parts.push({ part: ordered[index], record: result.record });
  }
  return { ok: true, parts };
}

function notFound(): LoadPartsResult {
  return { ok: false, reason: "not_found", message: "Inspection not found." };
}
