import "server-only";
import type { z } from "zod";
import { ExportPartSchema, ExportSchema, type InspectionExport, type InspectionPartExport } from "@/lib/schemas/export";
import { FILE_BUCKET, PHOTO_BUCKET } from "@/lib/photos/paths";
import type { ModuleRegistry } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { ExportViewer } from "./access";
import { assembleExport } from "./assemble";
import { evaluateRecord, type EvaluatedInspection } from "./evaluate";
import { loadInspectionParts } from "./parts";
import type { ExportClient, InspectionRecord } from "./record";
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
 * the JSON download. Photos, files, the client logo and the source form
 * go out as signed URLs valid for 24 hours.
 *
 * An inspection that covers several purchase orders (PO parts) is still
 * one document: the first part's export, with every other part's export
 * in `parts`, whichever part's id is given. exportFromEvaluation builds
 * one part's export alone, never with `parts`: the AI second opinion
 * reviews one part at a time.
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

/** The whole inspection's document by default; exportFromEvaluation gives one part's. */
export type ExportResult<Doc extends InspectionExport = InspectionExport> =
  | { ok: true; export: Doc; skipped: SkippedObject[] }
  /** `message` is safe to show: no keys, URLs or raw database errors. */
  | { ok: false; reason: ExportFailureReason; message: string };

export type BuildExportOptions = {
  /**
   * The signed-in user asking. Only the inspection's inspector or an admin
   * gets it, and only when every PO part is one they may export (anyone
   * else: `not_found`, as if it did not exist). Leave it out only for
   * server work that has checked access itself.
   */
  viewer?: ExportViewer;
  /** The module registry; tests pass the framework's test modules. */
  registry?: ModuleRegistry;
  /** Lifetime of the signed URLs. Default 24 hours. */
  urlTtlSeconds?: number;
  /** The export time. Default now. */
  now?: () => Date;
};

/** The export of the inspection `inspectionId` belongs to: every PO part, whichever part it names. */
export async function buildInspectionExport(
  supabase: ExportClient,
  inspectionId: string,
  options: BuildExportOptions = {},
): Promise<ExportResult> {
  const loaded = await loadInspectionParts(supabase, inspectionId, { viewer: options.viewer });
  if (!loaded.ok) return loaded;
  return exportOfParts(supabase, loaded.parts.map(({ record }) => record), options);
}

/**
 * The inspection export from its parts' records, already loaded and access
 * checked (loadInspectionParts), the first part first: that part's export,
 * with every other part's in `parts`, in the order given; no `parts` at all
 * for an inspection of one PO. All parts share one export time. A part that
 * cannot be evaluated or signed fails the whole document, so a report never
 * goes out with a PO missing.
 */
export async function exportOfParts(
  supabase: ExportClient,
  records: readonly InspectionRecord[],
  options: Omit<BuildExportOptions, "viewer"> = {},
): Promise<ExportResult> {
  const first = records[0];
  if (!first) throw new Error("exportOfParts needs the inspection's first part.");
  const registry = options.registry ?? MODULE_REGISTRY;
  const evaluated: { record: InspectionRecord; evaluated: EvaluatedInspection }[] = [];
  for (const record of records) {
    const evaluation = evaluateRecord(record, registry);
    if (!evaluation.ok) return evaluation;
    evaluated.push({ record, evaluated: evaluation.evaluated });
  }

  const exportedAt = options.now?.() ?? new Date();
  const built = await Promise.all(
    evaluated.map((part) =>
      exportFromEvaluation(supabase, part.record, part.evaluated, {
        urlTtlSeconds: options.urlTtlSeconds,
        now: () => exportedAt,
      }),
    ),
  );
  const exports: InspectionPartExport[] = [];
  const skipped: SkippedObject[] = [];
  for (const result of built) {
    if (!result.ok) return result;
    exports.push(result.export);
    skipped.push(...result.skipped);
  }

  const [main, ...others] = exports;
  if (others.length === 0) return { ok: true, export: main, skipped };
  const parsed = validated(ExportSchema, { ...main, parts: others }, first.refNo);
  return parsed.ok ? { ok: true, export: parsed.data, skipped } : parsed;
}

/**
 * One part's export, from its record already loaded and evaluated: never
 * with `parts`, whatever other parts its inspection has. The AI second
 * opinion reviews this, one part at a time, so its prompt stays one PO's.
 */
export async function exportFromEvaluation(
  supabase: ExportClient,
  record: InspectionRecord,
  evaluated: EvaluatedInspection,
  options: Pick<BuildExportOptions, "urlTtlSeconds" | "now"> = {},
): Promise<ExportResult<InspectionPartExport>> {
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

  const parsed = validated(ExportPartSchema, doc, record.refNo);
  return parsed.ok ? { ok: true, export: parsed.data, skipped } : parsed;
}

type ExportFailure = Extract<ExportResult, { ok: false }>;

/** The document as its schema reads it, or `invalid_export`: a fault in the app, never in the inspection. */
function validated<Doc extends InspectionExport>(
  schema: z.ZodType<Doc>,
  doc: unknown,
  refNo: string,
): { ok: true; data: Doc } | ExportFailure {
  const parsed = schema.safeParse(doc);
  if (parsed.success) return { ok: true, data: parsed.data };
  console.error(`[export] ${refNo}: the export failed its schema`, parsed.error.issues.slice(0, 10));
  const where = parsed.error.issues[0]?.path.map(String).join(".") || "the document";
  return {
    ok: false,
    reason: "invalid_export",
    message: `The export of ${refNo} is not valid (${where}). This is a fault in the app: report it.`,
  };
}

function storageError(message: string): ExportFailure {
  return { ok: false, reason: "storage_error", message };
}

function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
