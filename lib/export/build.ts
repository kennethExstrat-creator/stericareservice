import "server-only";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { FILE_BUCKET, PHOTO_BUCKET } from "@/lib/photos/paths";
import type { ModuleRegistry } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { canExportInspection, type ExportViewer } from "./access";
import { assembleExport } from "./assemble";
import { evaluateRecord, type EvaluatedInspection } from "./evaluate";
import { loadInspectionRecord, type ExportClient, type InspectionRecord } from "./record";
import {
  CLIENT_LOGO_BUCKET,
  EXPORT_URL_TTL_SECONDS,
  signObjects,
  TEMPLATE_SOURCE_BUCKET,
  type SignBucket,
} from "./sign";

/* ------------------------------------------------------------------ *
 * buildInspectionExport (BUILD_SPEC 9.1): one JSON document per
 * inspection, validated by ExportSchema, the input of the AI report and
 * the AI second opinion. Photos, files, the client logo and the source
 * form go out as signed URLs valid for 24 hours.
 *
 * It reads through the client it is given, so the caller decides who
 * may export: the route handler and the admin actions pass the
 * signed-in user's client (RLS: the owner or an admin), and only work no
 * session can do (a review started by an inspector's submit) passes the
 * service role.
 * ------------------------------------------------------------------ */

export type ExportFailureReason =
  | "not_found"
  | "database_error"
  | "unreadable_template"
  | "unreadable_data"
  | "storage_error"
  | "invalid_export";

/** An object the export left out because it could not be signed (missing in Storage, or not readable). */
export type SkippedObject = { bucket: SignBucket; path: string; id: string | null };

export type ExportResult =
  | { ok: true; export: InspectionExport; skipped: SkippedObject[] }
  /** `message` is safe to show: no keys, URLs or raw database errors. */
  | { ok: false; reason: ExportFailureReason; message: string };

export type BuildExportOptions = {
  /**
   * The signed-in user asking. Only the inspection's inspector or an admin
   * gets it (anyone else: `not_found`, as if it did not exist). Leave it out
   * only for server work that has checked access itself.
   */
  viewer?: ExportViewer;
  /** The module registry; tests pass the framework's test modules. */
  registry?: ModuleRegistry;
  /** Lifetime of the signed URLs. Default 24 hours. */
  urlTtlSeconds?: number;
  /** The export time. Default now. */
  now?: () => Date;
};

export async function buildInspectionExport(
  supabase: ExportClient,
  inspectionId: string,
  options: BuildExportOptions = {},
): Promise<ExportResult> {
  const loaded = await loadInspectionRecord(supabase, inspectionId);
  if (!loaded.ok) return loaded;
  if (options.viewer && !canExportInspection(options.viewer, loaded.record)) {
    return { ok: false, reason: "not_found", message: "Inspection not found." };
  }
  const evaluation = evaluateRecord(loaded.record, options.registry ?? MODULE_REGISTRY);
  if (!evaluation.ok) return evaluation;
  return exportFromEvaluation(supabase, loaded.record, evaluation.evaluated, options);
}

/** The export of an inspection already loaded and evaluated (the AI actions reuse both). */
export async function exportFromEvaluation(
  supabase: ExportClient,
  record: InspectionRecord,
  evaluated: EvaluatedInspection,
  options: Pick<BuildExportOptions, "urlTtlSeconds" | "now"> = {},
): Promise<ExportResult> {
  const ttl = options.urlTtlSeconds ?? EXPORT_URL_TTL_SECONDS;
  const skipped: SkippedObject[] = [];

  const sign = async (bucket: SignBucket, entries: readonly { path: string; id: string | null }[]) => {
    const signed = await signObjects(supabase, bucket, entries.map((entry) => entry.path), ttl);
    if (!signed.ok) return signed;
    for (const path of signed.missing) {
      skipped.push({ bucket, path, id: entries.find((entry) => entry.path === path)?.id ?? null });
    }
    return signed;
  };

  const logoPath = evaluated.template.report.showClientLogo ? blankToNull(record.client?.logoPath) : null;
  const sourcePath = blankToNull(record.template?.sourceFilePath) ?? evaluated.template.sourceFile;
  const [photos, files, logo, source] = await Promise.all([
    sign(PHOTO_BUCKET, record.photos.map((photo) => ({ path: photo.storagePath, id: photo.id }))),
    sign(FILE_BUCKET, record.files.map((file) => ({ path: file.storagePath, id: file.id }))),
    sign(CLIENT_LOGO_BUCKET, logoPath ? [{ path: logoPath, id: record.client?.id ?? null }] : []),
    sign(TEMPLATE_SOURCE_BUCKET, sourcePath ? [{ path: sourcePath, id: record.template?.id ?? null }] : []),
  ]);
  if (!photos.ok) return storageError(photos.message);
  if (!files.ok) return storageError(files.message);
  if (!logo.ok) return storageError(logo.message);
  if (!source.ok) return storageError(source.message);
  if (skipped.length > 0) {
    console.warn(`[export] ${record.refNo}: ${skipped.length} objects could not be signed and were left out`, skipped);
  }

  const doc = assembleExport({
    record,
    evaluated,
    links: {
      photos: photos.urls,
      files: files.urls,
      clientLogo: logoPath ? (logo.urls.get(logoPath) ?? null) : null,
      sourceFile: sourcePath ? (source.urls.get(sourcePath) ?? null) : null,
    },
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
  });

  const parsed = ExportSchema.safeParse(doc);
  if (!parsed.success) {
    console.error(`[export] ${record.refNo}: the export failed its schema`, parsed.error.issues.slice(0, 10));
    const where = parsed.error.issues[0]?.path.map(String).join(".") || "the document";
    return {
      ok: false,
      reason: "invalid_export",
      message: `The export of ${record.refNo} is not valid (${where}). This is a fault in the app: report it.`,
    };
  }
  return { ok: true, export: parsed.data, skipped };
}

function storageError(message: string): ExportResult {
  return { ok: false, reason: "storage_error", message };
}

function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
