import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MANUFACTURER_NAMES_SELECT, manufacturerLabel } from "@/lib/inspections/format";
import type { InspectionResult, InspectionStatus, ProductType, Standard } from "@/lib/schemas/common";
import { readPhotoDescription, type PhotoDescription } from "@/lib/schemas/photo-description";
import type { Database } from "@/lib/supabase/database.types";

/* ------------------------------------------------------------------ *
 * One inspection as the export and the AI panel read it: the row, its
 * template version, client, manufacturer and inspector, and its photo
 * and file rows. Read through whichever client the caller passes: the
 * signed-in user's (RLS decides what they may see) or, for work no
 * session can do, the service role.
 * ------------------------------------------------------------------ */

export type ExportClient = SupabaseClient<Database>;

/** The inspection, its template version and the names the export shows, in one request. */
export const INSPECTION_RECORD_SELECT =
  `id, ref_no, status, inspection_date, inspector_id, data, module_overrides, result, suggested_result, remarks, created_at, updated_at, submitted_at, approved_at, template:templates(id, code, version, standard, product_type, resolved, source_file_path), client:clients(id, name, logo_path), manufacturer:manufacturers(id, ${MANUFACTURER_NAMES_SELECT}), inspector:profiles!inspections_inspector_id_fkey(id, full_name, email, lead_id)` as const;

const PHOTO_SELECT =
  "id, module_key, target, storage_path, thumb_path, caption, taken_at, include_in_report, flagged, created_at";
/** Steri-AI's descriptions (migration 20261027200000), read apart: a project without them exports its photos all the same. */
const DESCRIPTION_SELECT = "id, ai_description";
const FILE_SELECT = "id, module_key, kind, storage_path, name, created_at";

/** Postgres undefined_column: a project that has not run migration 20261027200000. */
const UNDEFINED_COLUMN = "42703";

export type PhotoRecord = {
  id: string;
  moduleKey: string | null;
  target: string | null;
  storagePath: string;
  thumbPath: string | null;
  caption: string | null;
  takenAt: string | null;
  includeInReport: boolean;
  flagged: boolean;
  createdAt: string;
  /** What Steri-AI says the photo shows (docs/AI.md, "Describing photos"); null or absent until it has described it. */
  description?: PhotoDescription | null;
};

export type FileRecord = {
  id: string;
  moduleKey: string | null;
  kind: "lab_report" | "certificate" | "other";
  storagePath: string;
  name: string;
  createdAt: string;
};

export type InspectionRecord = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  inspectionDate: string;
  /** `data` as stored: `{ modules, custom }`. */
  data: unknown;
  moduleOverrides: unknown;
  result: InspectionResult | null;
  suggestedResult: InspectionResult | null;
  remarks: string | null;
  /** Timestamps exactly as Postgres returned them: `updatedAt` identifies the version. */
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  template: {
    id: string;
    code: string;
    version: number;
    standard: Standard;
    productType: ProductType;
    resolved: unknown;
    sourceFilePath: string | null;
  } | null;
  client: { id: string; name: string; logoPath: string | null } | null;
  /** The factory, named by its label (manufacturerLabel): "Top Glove · TG-F40". */
  manufacturer: { id: string; name: string } | null;
  /**
   * Always set (6.2 rule 11); `inspector` holds the profile when it could be
   * read, with `leadId`, the lead inspector whose team they are in
   * (profiles.lead_id), whom buildInspectionExport lets export it too
   * (canExportInspection's inspectorLeadId).
   */
  inspectorId: string;
  inspector: { id: string; fullName: string | null; email: string | null; leadId: string | null } | null;
  photos: PhotoRecord[];
  files: FileRecord[];
};

export type LoadRecordResult =
  | { ok: true; record: InspectionRecord }
  | { ok: false; reason: "not_found" | "database_error"; message: string };

const InspectionIdSchema = z.uuid();

/** A lowercase inspection id, or null when `value` is not a UUID (which then matches no inspection). */
export function parseInspectionId(value: unknown): string | null {
  const parsed = InspectionIdSchema.safeParse(typeof value === "string" ? value.trim().toLowerCase() : value);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the inspection and its photos and files. An id that is not a UUID,
 * or an inspection the client may not read (RLS), is `not_found`: the
 * caller cannot tell the two apart, and neither can anyone it answers.
 */
export async function loadInspectionRecord(client: ExportClient, inspectionId: string): Promise<LoadRecordResult> {
  const id = parseInspectionId(inspectionId);
  if (!id) return notFound();

  const [row, photos, described, files] = await Promise.all([
    client.from("inspections").select(INSPECTION_RECORD_SELECT).eq("id", id).maybeSingle(),
    client.from("inspection_photos").select(PHOTO_SELECT).eq("inspection_id", id),
    client.from("inspection_photos").select(DESCRIPTION_SELECT).eq("inspection_id", id),
    client.from("inspection_files").select(FILE_SELECT).eq("inspection_id", id),
  ]);
  if (row.error) return databaseError("the inspection", row.error);
  if (!row.data) return notFound();
  if (photos.error) return databaseError("the photos", photos.error);
  if (files.error) return databaseError("the files", files.error);
  // Without the descriptions (not yet on this project, or not read), the photos go out undescribed.
  if (described.error && described.error.code !== UNDEFINED_COLUMN) {
    console.error("[export] reading Steri-AI's descriptions failed", { code: described.error.code, message: described.error.message });
  }
  const descriptions = new Map(
    (described.error ? [] : (described.data ?? [])).map((photo) => [photo.id, readPhotoDescription(photo.ai_description)] as const),
  );

  const inspection = row.data;
  const template = one(inspection.template);
  const clientRow = one(inspection.client);
  const manufacturer = one(inspection.manufacturer);
  const inspector = one(inspection.inspector);

  return {
    ok: true,
    record: {
      id: inspection.id,
      refNo: inspection.ref_no,
      status: inspection.status,
      inspectionDate: inspection.inspection_date,
      data: inspection.data,
      moduleOverrides: inspection.module_overrides,
      result: inspection.result,
      suggestedResult: inspection.suggested_result,
      remarks: inspection.remarks,
      createdAt: inspection.created_at,
      updatedAt: inspection.updated_at,
      submittedAt: inspection.submitted_at,
      approvedAt: inspection.approved_at,
      template: template
        ? {
            id: template.id,
            code: template.code,
            version: template.version,
            standard: template.standard,
            productType: template.product_type,
            resolved: template.resolved,
            sourceFilePath: template.source_file_path,
          }
        : null,
      client: clientRow ? { id: clientRow.id, name: clientRow.name, logoPath: clientRow.logo_path } : null,
      manufacturer: manufacturer ? { id: manufacturer.id, name: manufacturerLabel(manufacturer) } : null,
      inspectorId: inspection.inspector_id,
      inspector: inspector
        ? { id: inspector.id, fullName: inspector.full_name, email: inspector.email, leadId: inspector.lead_id ?? null }
        : null,
      photos: photos.data.map((photo) => ({
        id: photo.id,
        moduleKey: photo.module_key,
        target: photo.target,
        storagePath: photo.storage_path,
        thumbPath: photo.thumb_path,
        caption: photo.caption,
        takenAt: photo.taken_at,
        includeInReport: photo.include_in_report,
        flagged: photo.flagged,
        createdAt: photo.created_at,
        description: descriptions.get(photo.id) ?? null,
      })),
      files: files.data.map((file) => ({
        id: file.id,
        moduleKey: file.module_key,
        kind: file.kind,
        storagePath: file.storage_path,
        name: file.name,
        createdAt: file.created_at,
      })),
    },
  };
}

/** PostgREST embeds a to-one relation as an object; older typings call it an array. */
function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function notFound(): LoadRecordResult {
  return { ok: false, reason: "not_found", message: "Inspection not found." };
}

function databaseError(what: string, error: { code?: string; message: string }): LoadRecordResult {
  console.error(`[export] reading ${what} failed`, { code: error.code, message: error.message });
  return { ok: false, reason: "database_error", message: `Could not read ${what}. Try again.` };
}
