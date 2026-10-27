import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileRef } from "@/lib/export/evaluate";
import { MANUFACTURER_NAMES_SELECT, manufacturerLabel, personLabel } from "@/lib/inspections/format";
import { PHOTO_BUCKET } from "@/lib/photos/paths";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { Database } from "@/lib/supabase/database.types";
import type { FileKind, InspectionFileRef } from "@/modules/_framework";
import { actorOf, type Actor, type KnownPeople } from "./actor";
import { buildAuditTrail, type AuditEntry } from "./audit";
import { evaluateStoredInspection, inspectorDecision, type ReviewEvaluation } from "./evaluate";
import { describePhoto, sectionWording, unlabelledDefects, type PhotoRow, type ReviewPhoto } from "./photos";

/**
 * Reads for /inspections/[id]/review. Always through the signed-in user's
 * client (lib/supabase/server), never the secret key: row level security
 * decides what comes back. An inspector gets their own inspections only,
 * so anyone else's reads as not found, exactly like one that does not exist;
 * a lead inspector also gets their team's, with the photos, files and
 * history the page shows (migration 20261007170000), and the team member's
 * name through the inspector embed.
 */

type Client = SupabaseClient<Database>;
type UserRole = Database["public"]["Enums"]["user_role"];

/** How long the photo links on the page work. Reloading the page signs new ones. */
export const PHOTO_URL_SECONDS = 60 * 60;

/** The inspector embed names its foreign key: approved_by also points at profiles. */
export const REVIEW_INSPECTION_SELECT =
  `id, ref_no, status, inspection_date, po_no, product_name, lot_numbers, data, module_overrides, result, remarks, suggested_result, created_at, updated_at, submitted_at, approved_at, approved_by, inspector_id, client:clients(id, name), manufacturer:manufacturers(id, ${MANUFACTURER_NAMES_SELECT}), inspector:profiles!inspections_inspector_id_fkey(id, full_name, email), approver:profiles!inspections_approved_by_fkey(id, full_name, email), template:templates(id, code, version, resolved)` as const;

const PHOTO_SELECT = "id, module_key, target, caption, storage_path, thumb_path, taken_at, flagged";
const AUDIT_SELECT = "id, action, changes, at, actor_id, actor:profiles(full_name, email)";
const FILE_SELECT = "id, module_key, kind";

export type ReviewViewer = { id: string; name: string; role: UserRole };

export type ReviewInspection = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  /** `updated_at` exactly as Postgres returned it: the version an approve applies to. */
  version: string;
  inspectionDate: string;
  poNo: string | null;
  productName: string | null;
  lotNumbers: string[];
  client: string | null;
  manufacturer: string | null;
  inspector: { id: string; name: string };
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Who approved it, as the viewer may know them. */
  approver: Actor | null;
  /** The inspector's final result and remark: the conclusion's own, else the row's copies (inspectorDecision). */
  result: InspectionResult | null;
  remarks: string | null;
  /** The suggestion saved with the inspection, which the app worked out when it was last saved. */
  savedSuggestion: InspectionResult | null;
};

export type ReviewTemplate = { id: string; code: string; version: number; name: string | null };

/** A module an admin switched off for this inspection (BUILD_SPEC 4.4). */
export type ReviewOverride = { key: ModuleKey; title: string; reason: string; by: Actor; at: string };

export type ReviewData = {
  viewer: ReviewViewer;
  inspection: ReviewInspection;
  template: ReviewTemplate | null;
  evaluation: ReviewEvaluation;
  overrides: ReviewOverride[];
  /** Photos marked "include in report"; `total` counts every photo, null when it could not be read. */
  photos: { items: ReviewPhoto[]; total: number | null; failed: boolean };
  history: { entries: AuditEntry[]; failed: boolean };
};

export type ReviewLoad = { kind: "not_found" } | { kind: "ok"; review: ReviewData };

function logFailure(what: string, error: { code?: string; message: string }) {
  console.error(`Inspection review: ${what} failed`, { code: error.code, message: error.message });
}

/**
 * Everything the review shows, read in parallel. The inspection itself must
 * load; photos and history that fail show as such instead of failing the page.
 */
export async function loadReview(supabase: Client, inspectionId: string, viewer: ReviewViewer): Promise<ReviewLoad> {
  const [row, photoRows, photoCount, auditRows, fileRows] = await Promise.all([
    supabase.from("inspections").select(REVIEW_INSPECTION_SELECT).eq("id", inspectionId).maybeSingle(),
    supabase
      .from("inspection_photos")
      .select(PHOTO_SELECT)
      .eq("inspection_id", inspectionId)
      .eq("include_in_report", true)
      .order("taken_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("inspection_photos").select("id", { count: "exact", head: true }).eq("inspection_id", inspectionId),
    supabase
      .from("audit_log")
      .select(AUDIT_SELECT)
      .eq("inspection_id", inspectionId)
      .order("at", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("inspection_files").select(FILE_SELECT).eq("inspection_id", inspectionId),
  ]);

  if (row.error) {
    logFailure("the inspection", row.error);
    throw new Error("The inspection could not be loaded.");
  }
  if (!row.data) return { kind: "not_found" };
  const found = row.data;

  const inspectorName = personLabel(found.inspector) ?? "Unknown inspector";
  const manufacturer = found.manufacturer ? { id: found.manufacturer.id, name: manufacturerLabel(found.manufacturer) } : null;
  const people: KnownPeople = {
    viewerId: viewer.id,
    viewerName: viewer.name,
    inspectorId: found.inspector_id,
    inspectorName,
  };
  const evaluation = evaluateStoredInspection({
    refNo: found.ref_no,
    inspectionDate: found.inspection_date,
    data: found.data,
    moduleOverrides: found.module_overrides,
    resolved: found.template?.resolved ?? null,
    inspector: { id: found.inspector_id, name: inspectorName },
    client: found.client ? { id: found.client.id, name: found.client.name } : null,
    manufacturer,
    files: inspectionFiles(fileRows),
  });
  const header = evaluation.ok ? evaluation.context.header : null;
  const decision = inspectorDecision({ result: found.result, remarks: found.remarks }, evaluation);

  const inspection: ReviewInspection = {
    id: found.id,
    refNo: found.ref_no,
    status: found.status,
    version: found.updated_at,
    inspectionDate: found.inspection_date,
    // The row mirrors the header module; until it has, the header's own values.
    poNo: found.po_no ?? header?.poNo ?? null,
    productName: found.product_name ?? header?.productName ?? null,
    lotNumbers: found.lot_numbers,
    client: found.client?.name ?? null,
    manufacturer: manufacturer?.name ?? null,
    inspector: { id: found.inspector_id, name: inspectorName },
    createdAt: found.created_at,
    submittedAt: found.submitted_at,
    approvedAt: found.approved_at,
    approver: found.approved_by ? actorOf(found.approved_by, found.approver, people) : null,
    result: decision.result,
    remarks: decision.remarks,
    savedSuggestion: found.suggested_result,
  };

  const template: ReviewTemplate | null = found.template
    ? {
        id: found.template.id,
        code: found.template.code,
        version: found.template.version,
        name: evaluation.ok ? evaluation.template.name : null,
      }
    : null;

  const [overrides, photos] = await Promise.all([
    loadOverrides(supabase, evaluation, viewer, people),
    signPhotos(supabase, evaluation, photoRows, photoCount),
  ]);

  if (auditRows.error) logFailure("the history", auditRows.error);
  const history = {
    failed: Boolean(auditRows.error),
    entries: auditRows.error
      ? []
      : buildAuditTrail(
          auditRows.data.map((entry) => ({
            id: entry.id,
            action: entry.action,
            changes: entry.changes,
            at: entry.at,
            actorId: entry.actor_id,
            actor: entry.actor,
          })),
          people,
        ),
  };

  return { kind: "ok", review: { viewer, inspection, template, evaluation, overrides, photos, history } };
}

type FileRowsResult = {
  data: { id: string; module_key: string | null; kind: FileKind }[] | null;
  error: { code?: string; message: string } | null;
};

/**
 * The inspection's files for the context. Null when they could not be read:
 * not knowing them is not the same as having none, so a lab report kept by
 * a module never reads as deleted because of a failed read.
 */
export function inspectionFiles(rows: FileRowsResult): InspectionFileRef[] | null {
  if (rows.error || !rows.data) {
    if (rows.error) logFailure("the files", rows.error);
    return null;
  }
  return rows.data.map((file) => fileRef({ id: file.id, moduleKey: file.module_key, kind: file.kind }));
}

/** Modules switched off for this inspection, with who did it. Only admins can read other people's names. */
async function loadOverrides(
  supabase: Client,
  evaluation: ReviewEvaluation,
  viewer: ReviewViewer,
  people: KnownPeople,
): Promise<ReviewOverride[]> {
  if (!evaluation.ok) return [];
  const switchedOff = evaluation.template.modules.flatMap((entry) =>
    entry.override ? [{ key: entry.key, title: entry.title, ...entry.override }] : [],
  );
  if (switchedOff.length === 0) return [];

  const profiles = new Map<string, { full_name: string | null; email: string | null }>();
  const others = [...new Set(switchedOff.map((entry) => entry.by))].filter((id) => id !== viewer.id);
  if (viewer.role === "admin" && others.length > 0) {
    const found = await supabase.from("profiles").select("id, full_name, email").in("id", others);
    if (found.error) logFailure("the names of who switched modules off", found.error);
    for (const person of found.data ?? []) profiles.set(person.id, person);
  }
  return switchedOff.map(({ key, title, reason, by, at }) => ({
    key,
    title,
    reason,
    at,
    by: actorOf(by, profiles.get(by) ?? null, people),
  }));
}

type PhotoRowsResult = { data: PhotoRow[] | null; error: { code?: string; message: string } | null };
type CountResult = { count: number | null; error: { code?: string; message: string } | null };

/** Report photos with signed thumbnail and full-size links, read as the user (storage policies apply). */
async function signPhotos(
  supabase: Client,
  evaluation: ReviewEvaluation,
  rows: PhotoRowsResult,
  count: CountResult,
): Promise<ReviewData["photos"]> {
  if (count.error) logFailure("the photo count", count.error);
  const total = count.error ? null : (count.count ?? 0);
  if (rows.error || !rows.data) {
    if (rows.error) logFailure("the report photos", rows.error);
    return { items: [], total, failed: true };
  }
  if (rows.data.length === 0) return { items: [], total, failed: false };

  const wording = sectionWording(evaluation);
  const paths = [...new Set(rows.data.flatMap((photo) => [photo.storage_path, ...(photo.thumb_path ? [photo.thumb_path] : [])]))];
  const codes = unlabelledDefects(rows.data, wording);
  const [signed, defects] = await Promise.all([
    supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS),
    codes.length > 0 ? supabase.from("defect_codes").select("code, name").in("code", codes) : null,
  ]);
  if (signed.error) logFailure("signing the photo links", signed.error);
  if (defects?.error) logFailure("the defect names", defects.error);
  const urls = new Map<string, string>();
  for (const entry of signed.data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  const defectNames = new Map((defects?.data ?? []).map((defect) => [defect.code, defect.name]));

  const items = rows.data.map((photo) => {
    const fullUrl = urls.get(photo.storage_path) ?? null;
    // A flagged photo is the unconverted original (often HEIC): no thumbnail,
    // and most browsers cannot show it, so it gets no preview, only its link.
    const thumbUrl = photo.thumb_path ? (urls.get(photo.thumb_path) ?? null) : photo.flagged ? null : fullUrl;
    return { ...describePhoto(photo, wording, defectNames), thumbUrl, fullUrl };
  });
  const unsigned = items.some((photo) => photo.fullUrl === null);
  return { items, total, failed: Boolean(signed.error) || unsigned };
}
