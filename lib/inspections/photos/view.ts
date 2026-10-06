// What the photo and file screens show (BUILD_SPEC 8.1): rows of
// inspection_photos and inspection_files with their signed URLs, the tag
// options of the inspection's template, and how photos group by module.
// Pure, and free of server-only imports: the gallery renders it on the
// server and the capture screen's photo slot on the iPad.
import type { InspectionFileKind } from "@/lib/photos/files";
import { MODULE_TARGET_KEYS, parseTarget, type PhotoTarget, type TargetKey } from "@/lib/photos/target";
import type { InspectionStatus } from "@/lib/schemas/common";
import { isModuleKey } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Tables } from "@/lib/supabase/database.types";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates/overrides";
import { templateSections } from "@/lib/templates/sections";

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

/** The inspection_photos columns the screens read. */
export const PHOTO_COLUMNS =
  "id, inspection_id, module_key, target, storage_path, thumb_path, caption, taken_at, width, height, flagged, include_in_report, created_by, created_at";

/** The inspection_files columns the screens read. */
export const FILE_COLUMNS = "id, inspection_id, module_key, kind, storage_path, name, created_by, created_at";

export type PhotoRow = Pick<
  Tables<"inspection_photos">,
  | "id"
  | "inspection_id"
  | "module_key"
  | "target"
  | "storage_path"
  | "thumb_path"
  | "caption"
  | "taken_at"
  | "width"
  | "height"
  | "flagged"
  | "include_in_report"
  | "created_by"
  | "created_at"
>;

export type FileRow = Pick<
  Tables<"inspection_files">,
  "id" | "inspection_id" | "module_key" | "kind" | "storage_path" | "name" | "created_by" | "created_at"
>;

/** An uploaded photo, as the screens show it. */
export interface MediaPhoto {
  id: string;
  inspectionId: string;
  /** Module or custom module key; null when not tagged yet. */
  moduleKey: string | null;
  /** `size:M/hand:R/defect:thin_spot/box:253` (lib/photos target format). */
  target: string | null;
  caption: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  /** The browser could not convert it: the original, waiting for conversion. */
  flagged: boolean;
  includeInReport: boolean;
  createdBy: string;
  createdAt: string;
  storagePath: string;
  thumbPath: string | null;
  /** Signed URL of the 400 px thumbnail (or of the original, for a flagged photo a browser can show). */
  thumbUrl: string | null;
  /** Signed URL of the full photo. */
  fullUrl: string | null;
}

/** An uploaded lab report or certificate. */
export interface MediaFile {
  id: string;
  inspectionId: string;
  moduleKey: string | null;
  kind: InspectionFileKind;
  name: string;
  createdBy: string;
  createdAt: string;
  storagePath: string;
  /** Signed URL, opened in a new tab. */
  url: string | null;
}

/** Originals a browser shows as they are, so a flagged one can be its own preview. HEIC needs Safari. */
const VIEWABLE_ORIGINAL = /\.(jpe?g|png|webp)$/i;

/** The object a photo's tile shows: its thumbnail, or a flagged original a browser can show. */
export function previewPath(row: Pick<PhotoRow, "storage_path" | "thumb_path">): string | null {
  if (row.thumb_path) return row.thumb_path;
  return VIEWABLE_ORIGINAL.test(row.storage_path) ? row.storage_path : null;
}

export function toMediaPhoto(row: PhotoRow, urls: ReadonlyMap<string, string>): MediaPhoto {
  const preview = previewPath(row);
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    moduleKey: blankToNull(row.module_key),
    target: blankToNull(row.target),
    caption: blankToNull(row.caption),
    takenAt: row.taken_at,
    width: row.width,
    height: row.height,
    flagged: row.flagged,
    includeInReport: row.include_in_report,
    createdBy: row.created_by,
    createdAt: row.created_at,
    storagePath: row.storage_path,
    thumbPath: row.thumb_path,
    thumbUrl: preview ? (urls.get(preview) ?? null) : null,
    fullUrl: urls.get(row.storage_path) ?? null,
  };
}

export function toMediaFile(row: FileRow, urls: ReadonlyMap<string, string>): MediaFile {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    moduleKey: blankToNull(row.module_key),
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    storagePath: row.storage_path,
    url: urls.get(row.storage_path) ?? null,
  };
}

/** The objects to sign for a list of photos: every full photo and every preview. */
export function photoObjectPaths(rows: readonly Pick<PhotoRow, "storage_path" | "thumb_path">[]): string[] {
  const paths = new Set<string>();
  for (const row of rows) {
    paths.add(row.storage_path);
    const preview = previewPath(row);
    if (preview) paths.add(preview);
  }
  return [...paths];
}

function blankToNull(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

export interface MediaAccess {
  /** Add, retag, caption and delete: the owner while draft or reopened; admins until approved. */
  canEdit: boolean;
  /** Admins choose report photos, also on an approved inspection. */
  isAdmin: boolean;
}

/** Why the photos cannot change, for the notice above them; null when they can. */
export function readOnlyReason(status: InspectionStatus, access: MediaAccess): string | null {
  if (access.canEdit) return null;
  if (status === "approved") {
    return access.isAdmin
      ? "This inspection is approved, so its photos and files are final. You can still choose which photos go into the report."
      : "This inspection is approved, so its photos and files are final.";
  }
  if (status === "submitted") {
    return "This inspection has been submitted, so its photos and files can no longer change. An admin can reopen it.";
  }
  return "You can view these photos and files, but not change them.";
}

/* ------------------------------------------------------------------ *
 * Tag options: what a photo can be tagged with in this inspection
 * ------------------------------------------------------------------ */

export interface ModuleOption {
  /** Module or custom module key. */
  key: string;
  /** In the template's wording. */
  title: string;
  /** What a photo in this module records besides the module (lib/photos MODULE_TARGET_KEYS). */
  targetKeys: readonly TargetKey[];
  /** Right and left hands recorded apart (watertight and visual with handSplit). */
  handSplit: boolean;
  /** False: switched off in the template or for this inspection. Kept so its photos still have a name. */
  included: boolean;
}

export interface SizeOption {
  value: string;
  label: string;
}

export interface DefectOption {
  code: string;
  name: string;
}

export interface PhotoTagOptions {
  /** Included modules in screen order, then switched-off ones. */
  modules: readonly ModuleOption[];
  sizes: readonly SizeOption[];
  /** Active defect codes, by name. */
  defects: readonly DefectOption[];
  /** Defect wording per module from the template's labels: `{ visual: { thin_spot: "Thin spot on glove body" } }`. */
  defectLabels: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export const EMPTY_TAG_OPTIONS: PhotoTagOptions = { modules: [], sizes: [], defects: [], defectLabels: {} };

/** Custom modules repeat per size at most (BUILD_SPEC 4.3, grid.repeatPer). */
const CUSTOM_TARGET_KEYS: readonly TargetKey[] = ["size"];

/** The target keys a photo in this module records. Untagged photos record none. */
export function targetKeysFor(moduleKey: string | null): readonly TargetKey[] {
  if (moduleKey === null) return [];
  return isModuleKey(moduleKey) ? MODULE_TARGET_KEYS[moduleKey] : CUSTOM_TARGET_KEYS;
}

/**
 * Tag options from the inspection's resolved template (templates.resolved)
 * and its per-inspection overrides. A template that does not parse gives no
 * modules or sizes: the screens then fall back to plain module names.
 */
export function tagOptionsFromTemplate(
  resolved: unknown,
  moduleOverrides: unknown,
  defects: readonly DefectOption[],
): PhotoTagOptions {
  const parsed = ResolvedTemplateSchema.safeParse(resolved);
  if (!parsed.success) return { ...EMPTY_TAG_OPTIONS, defects };
  const template = applyModuleOverrides(parsed.data, parseModuleOverrides(moduleOverrides));

  const modules: ModuleOption[] = [];
  const defectLabels: Record<string, Record<string, string>> = {};
  for (const section of templateSections(template)) {
    if (section.kind === "module") {
      modules.push({
        key: section.key,
        title: section.module.title,
        targetKeys: targetKeysFor(section.key),
        handSplit: section.module.config.handSplit === true,
        included: true,
      });
      defectLabels[section.key] = defectWording(section.module.labels, defects);
    } else {
      modules.push({ key: section.key, title: section.custom.title, targetKeys: CUSTOM_TARGET_KEYS, handSplit: false, included: true });
    }
  }
  for (const entry of template.modules) {
    if (entry.include) continue;
    modules.push({
      key: entry.key,
      title: entry.title,
      targetKeys: targetKeysFor(entry.key),
      handSplit: entry.config.handSplit === true,
      included: false,
    });
    defectLabels[entry.key] = defectWording(entry.labels, defects);
  }
  return { modules, sizes: template.sizes.map(({ value, label }) => ({ value, label })), defects, defectLabels };
}

/** The template's word for each defect code: its own key, else a dotted key (`minor.bead_defective`). */
function defectWording(labels: Readonly<Record<string, string>>, defects: readonly DefectOption[]): Record<string, string> {
  const wording: Record<string, string> = {};
  const entries = Object.entries(labels);
  for (const { code } of defects) {
    const label = labels[code] ?? entries.find(([key]) => key.endsWith(`.${code}`))?.[1];
    if (label) wording[code] = label;
  }
  return wording;
}

/** "dispensing_packing" as "Dispensing packing": the name of a module the template does not know. */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export const UNTAGGED_TITLE = "Not tagged";

export function moduleTitle(moduleKey: string | null, options: PhotoTagOptions): string {
  if (moduleKey === null) return UNTAGGED_TITLE;
  return options.modules.find((entry) => entry.key === moduleKey)?.title ?? humanizeKey(moduleKey);
}

export function moduleOption(moduleKey: string | null, options: PhotoTagOptions): ModuleOption | null {
  if (moduleKey === null) return null;
  return (
    options.modules.find((entry) => entry.key === moduleKey) ?? {
      key: moduleKey,
      title: humanizeKey(moduleKey),
      targetKeys: targetKeysFor(moduleKey),
      handSplit: false,
      included: false,
    }
  );
}

/** The defect's name in this module's wording, else the master list's name, else the code or label itself. */
export function defectName(moduleKey: string | null, defect: string, options: PhotoTagOptions): string {
  return (
    (moduleKey ? options.defectLabels[moduleKey]?.[defect] : undefined) ??
    options.defects.find((entry) => entry.code === defect)?.name ??
    defect
  );
}

/* ------------------------------------------------------------------ *
 * Display tags
 * ------------------------------------------------------------------ */

/** The tags a tile shows (components/qc PhotoTags). */
export interface DisplayTags {
  module: string;
  size?: string;
  hand?: string;
  defect?: string;
  box?: string;
}

/**
 * A photo's tags in words. `withModule: false` leaves the module out when
 * something else is tagged, for tiles already under the module's heading.
 */
export function displayTags(
  moduleKey: string | null,
  target: string | null,
  options: PhotoTagOptions,
  { withModule = true }: { withModule?: boolean } = {},
): DisplayTags {
  const parsed = parseTarget(target);
  const focus: PhotoTarget = parsed.ok ? parsed.target : {};
  const tags: DisplayTags = {
    module: moduleTitle(moduleKey, options),
    // The canonical size ("Size M", "Size 7.0"), as on the size tabs.
    size: focus.size,
    hand: focus.hand,
    defect: focus.defect ? defectName(moduleKey, focus.defect, options) : undefined,
    box: focus.box !== undefined ? String(focus.box) : undefined,
  };
  const hasFocus = Boolean(tags.size || tags.hand || tags.defect || tags.box);
  return withModule || !hasFocus ? tags : { ...tags, module: "" };
}

/** Keeps the parts of a target this module records: a box tag does not follow a photo into dimensions. */
export function targetForModule(moduleKey: string | null, target: PhotoTarget): PhotoTarget {
  const keys = targetKeysFor(moduleKey);
  const kept: PhotoTarget = {};
  if (keys.includes("size") && target.size !== undefined) kept.size = target.size;
  if (keys.includes("hand") && target.hand !== undefined) kept.hand = target.hand;
  if (keys.includes("defect") && target.defect !== undefined) kept.defect = target.defect;
  if (keys.includes("box") && target.box !== undefined) kept.box = target.box;
  return kept;
}

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

export interface ModuleGroup<T> {
  /** Module or custom module key; null for photos not tagged yet. */
  key: string | null;
  title: string;
  /** False for a module switched off, or one the template does not know. */
  included: boolean;
  items: T[];
}

/**
 * Items by module, in the template's screen order: included modules, then
 * switched-off ones, then keys the template does not know (by name), then
 * the photos not tagged yet. Only groups that hold something.
 */
export function groupByModule<T extends { moduleKey: string | null }>(
  items: readonly T[],
  options: PhotoTagOptions,
): ModuleGroup<T>[] {
  const byKey = new Map<string | null, T[]>();
  for (const item of items) byKey.set(item.moduleKey, [...(byKey.get(item.moduleKey) ?? []), item]);

  const groups: ModuleGroup<T>[] = [];
  for (const entry of options.modules) {
    const found = byKey.get(entry.key);
    if (!found) continue;
    groups.push({ key: entry.key, title: entry.title, included: entry.included, items: found });
    byKey.delete(entry.key);
  }
  const unknown = [...byKey.keys()]
    .filter((key): key is string => key !== null)
    .map((key) => ({ key, title: humanizeKey(key) }))
    .sort((a, b) => a.title.localeCompare(b.title));
  for (const { key, title } of unknown) groups.push({ key, title, included: false, items: byKey.get(key) ?? [] });
  const untagged = byKey.get(null);
  if (untagged) groups.push({ key: null, title: UNTAGGED_TITLE, included: true, items: untagged });
  return groups;
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const FILE_KIND_LABEL: Readonly<Record<InspectionFileKind, string>> = {
  lab_report: "Lab report",
  certificate: "Certificate",
  other: "Document",
};

/** "1 photo", "3 photos". */
export function countPhotos(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

/** "1 file", "2 files". */
export function countFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}
