// What the photo and file screens show (BUILD_SPEC 8.1): rows of
// inspection_photos and inspection_files with their signed URLs, the tag
// options of the inspection's template, and how photos group by module.
// Source Documents' Media categories (lib/inspections/source-documents.ts)
// are tags too, named by their titles wherever a tag is named; a module is
// named by its short name, as the capture screen's menus name it
// (lib/templates/short-titles.ts; docs/DESIGN.md, Step Names). Pure, and
// free of server-only imports: the gallery renders it on the server and the
// capture screen's photo slot on the iPad.
import { isMediaCategoryKey, MEDIA_CATEGORIES, mediaCategory } from "@/lib/inspections/source-documents";
import type { InspectionFileKind } from "@/lib/photos/files";
import { MODULE_TARGET_KEYS, parseTarget, type PhotoTarget, type TargetKey } from "@/lib/photos/target";
import type { InspectionStatus } from "@/lib/schemas/common";
import { isModuleKey } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema, type ResolvedModule } from "@/lib/schemas/template";
import type { Tables } from "@/lib/supabase/database.types";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates/overrides";
import { templateSections } from "@/lib/templates/sections";
import { customShortTitle, shortTitleFor } from "@/lib/templates/short-titles";
import { humanize } from "@/lib/zod-form/labels";
// The default wording of the three lists a photo's level or item comes from: config files only, no module code.
import { DOCUMENT_ITEMS, DOCUMENTS_LABELS } from "@/modules/documents/config";
import { LABELING_LABELS } from "@/modules/labeling/config";
import { LOADING_LABELS, LOADING_STAGES } from "@/modules/loading/config";

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

/**
 * Whether a browser shows the stored photo full size: every converted
 * photo, and a flagged original only in a type all browsers read (an
 * unconverted HEIC breaks in Chrome, Edge and Firefox).
 */
export function showsFullSize(photo: { flagged: boolean; storagePath: string }): boolean {
  return !photo.flagged || VIEWABLE_ORIGINAL.test(photo.storagePath);
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
  /** How the photo screens name it: the step's short name (lib/templates/short-titles.ts); a Media category's title. */
  shortTitle: string;
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

/** An entry of a module's own list, or a packaging level: its key and its words. */
export interface ListChoice {
  value: string;
  label: string;
}

export interface PhotoTagOptions {
  /** Included modules in screen order, then switched-off ones. */
  modules: readonly ModuleOption[];
  sizes: readonly SizeOption[];
  /** Active defect codes, by name. */
  defects: readonly DefectOption[];
  /** Defect wording per module from the template's labels: `{ visual: { thin_spot: "Thin Spot on Glove Body" } }`. */
  defectLabels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The packaging levels a module records, in its wording: `{ labeling: [inner "Dispenser Box", carton "Carton Box"] }`. */
  levels?: Readonly<Record<string, readonly ListChoice[]>>;
  /** The entries of a module's own list, in order and in its wording: documents' checklist, loading's stages. */
  items?: Readonly<Record<string, readonly ListChoice[]>>;
}

export const EMPTY_TAG_OPTIONS: PhotoTagOptions = { modules: [], sizes: [], defects: [], defectLabels: {}, levels: {}, items: {} };

/** Custom modules repeat per size at most (BUILD_SPEC 4.3, grid.repeatPer). */
const CUSTOM_TARGET_KEYS: readonly TargetKey[] = ["size"];

/**
 * The target keys a photo in this module records. Untagged photos record
 * none, and neither do Media's categories: the category says what the photo
 * is, its caption the rest.
 */
export function targetKeysFor(moduleKey: string | null): readonly TargetKey[] {
  if (moduleKey === null || isMediaCategoryKey(moduleKey)) return [];
  return isModuleKey(moduleKey) ? MODULE_TARGET_KEYS[moduleKey] : CUSTOM_TARGET_KEYS;
}

/**
 * Source Documents' Media categories as tags, in their order: offered
 * whatever the template, before its modules (photos are added on Media).
 */
export const MEDIA_CATEGORY_OPTIONS: readonly ModuleOption[] = MEDIA_CATEGORIES.map(({ key, title }) => ({
  key,
  title,
  shortTitle: title,
  targetKeys: [],
  handSplit: false,
  included: true,
}));

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
  const levels: Record<string, ListChoice[]> = {};
  const items: Record<string, ListChoice[]> = {};
  const addLists = (entry: ResolvedModule) => {
    const keys = targetKeysFor(entry.key);
    if (keys.includes("level")) levels[entry.key] = levelChoices(entry);
    if (keys.includes("item")) items[entry.key] = itemChoices(entry);
  };
  for (const section of templateSections(template)) {
    if (section.kind === "module") {
      modules.push({
        key: section.key,
        title: section.module.title,
        shortTitle: shortTitleFor(section.key, section.module.title),
        targetKeys: targetKeysFor(section.key),
        handSplit: section.module.config.handSplit === true,
        included: true,
      });
      defectLabels[section.key] = defectWording(section.module, defects);
      addLists(section.module);
    } else {
      modules.push({
        key: section.key,
        title: section.custom.title,
        shortTitle: customShortTitle(section.custom),
        targetKeys: CUSTOM_TARGET_KEYS,
        handSplit: false,
        included: true,
      });
    }
  }
  for (const entry of template.modules) {
    if (entry.include) continue;
    modules.push({
      key: entry.key,
      title: entry.title,
      shortTitle: shortTitleFor(entry.key, entry.title),
      targetKeys: targetKeysFor(entry.key),
      handSplit: entry.config.handSplit === true,
      included: false,
    });
    defectLabels[entry.key] = defectWording(entry, defects);
    addLists(entry);
  }
  return { modules, sizes: template.sizes.map(({ value, label }) => ({ value, label })), defects, defectLabels, levels, items };
}

/** Labelling's two levels in the template's wording (`innerLevel`, `cartonLevel`), else the module's own. */
function levelChoices(entry: ResolvedModule): ListChoice[] {
  return [
    { value: "inner", label: wordOf(entry.labels.innerLevel) ?? LABELING_LABELS.innerLevel },
    { value: "carton", label: wordOf(entry.labels.cartonLevel) ?? LABELING_LABELS.cartonLevel },
  ];
}

/**
 * The entries of a module's own list in the template's order and wording:
 * the documents its checklist includes, or loading's stages. A label is
 * keyed by the entry's key in both modules.
 */
function itemChoices(entry: ResolvedModule): ListChoice[] {
  const label = (key: string, fallback: string | undefined) => wordOf(entry.labels[key]) ?? fallback ?? humanizeKey(key);
  if (entry.key === "documents") {
    // A resolved template holds the whole config; without a list, the module's default checklist.
    const keys = Array.isArray(entry.config.items)
      ? (entry.config.items as unknown[]).flatMap((item) => {
          if (typeof item !== "object" || item === null) return [];
          const { key, include } = item as { key?: unknown; include?: unknown };
          return typeof key === "string" && include !== false ? [key] : [];
        })
      : [...DOCUMENT_ITEMS];
    const defaults = DOCUMENTS_LABELS as Readonly<Record<string, string>>;
    return keys.map((key) => ({ value: key, label: label(key, defaults[key]) }));
  }
  if (entry.key === "loading") return LOADING_STAGES.map((stage) => ({ value: stage, label: label(stage, LOADING_LABELS[stage]) }));
  return [];
}

function wordOf(label: string | undefined): string | null {
  return label !== undefined && label.trim() !== "" ? label : null;
}

/**
 * The template's word for each defect code, as the module's own rows read it.
 * First its labels: the code's own key, else a dotted key
 * (`minor.bead_defective`). Then the defect lists in its config, where the
 * counter rows take their words (visual's classes, watertight's hole
 * locations, Safedon's items): every `{ code, label }`, the first for a code,
 * so a code listed in two classes keeps the first class's word. Codes only the
 * template lists are named too. Without this a photo's tag fell back to the
 * master list's name, which may be worded differently from the row beside it.
 */
function defectWording(
  module: { labels: Readonly<Record<string, string>>; config: unknown },
  defects: readonly DefectOption[],
): Record<string, string> {
  const listed = listedDefects(module.config);
  const wording: Record<string, string> = {};
  const entries = Object.entries(module.labels);
  for (const { code } of defects) {
    const label = module.labels[code] ?? entries.find(([key]) => key.endsWith(`.${code}`))?.[1] ?? listed.get(code);
    if (label) wording[code] = label;
  }
  for (const [code, label] of listed) {
    if (!(code in wording)) wording[code] = label;
  }
  return wording;
}

/** Every `{ code, label }` entry in a module's config, depth first, the first one for each code. */
function listedDefects(config: unknown): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const { code, label } = value as { code?: unknown; label?: unknown };
    if (typeof code === "string" && typeof label === "string" && label.trim() !== "" && !found.has(code)) {
      found.set(code, label);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(config);
  return found;
}

/**
 * "dispensing_packing" as "Dispensing Packing", "doorsClosed" as "Doors
 * Closed": the name of a module, document or stage the template does not
 * know, in Title Case as every label the app writes from a key
 * (lib/zod-form humanize; docs/DESIGN.md, Capitalisation).
 */
export function humanizeKey(key: string): string {
  return humanize(key.trim()) || key;
}

export const UNTAGGED_TITLE = "Not Tagged";

/** The tag picker's label (the photo edit dialog): a photo goes in a Media category or under a module. */
export const TAG_FIELD_LABEL = "Category or Module";

/** The tag pickers' two lists, by these headings. */
export const TAG_GROUP_LABEL = { categories: "Media Categories", modules: "Modules" } as const;

/** A tag in words: a Media category by its title, a module by its short name, else its key in words. */
export function moduleTitle(moduleKey: string | null, options: PhotoTagOptions): string {
  if (moduleKey === null) return UNTAGGED_TITLE;
  return (
    mediaCategory(moduleKey)?.title ??
    options.modules.find((entry) => entry.key === moduleKey)?.shortTitle ??
    humanizeKey(moduleKey)
  );
}

export function moduleOption(moduleKey: string | null, options: PhotoTagOptions): ModuleOption | null {
  if (moduleKey === null) return null;
  return (
    MEDIA_CATEGORY_OPTIONS.find((entry) => entry.key === moduleKey) ??
    options.modules.find((entry) => entry.key === moduleKey) ?? {
      key: moduleKey,
      title: humanizeKey(moduleKey),
      shortTitle: humanizeKey(moduleKey),
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

/** The packaging level in the module's wording ("Dispenser Box"), else in plain words. */
export function levelName(moduleKey: string | null, level: string, options: PhotoTagOptions): string {
  const found = moduleKey ? options.levels?.[moduleKey]?.find((choice) => choice.value === level) : undefined;
  return found?.label ?? (level === "inner" ? "Inner Unit" : humanizeKey(level));
}

/**
 * An entry of the module's own list in the template's wording ("Doors
 * closed"), else the module's own (a document the checklist no longer
 * includes), else its key in words.
 */
export function itemName(moduleKey: string | null, item: string, options: PhotoTagOptions): string {
  const found = moduleKey ? options.items?.[moduleKey]?.find((choice) => choice.value === item) : undefined;
  return found?.label ?? defaultItemLabel(moduleKey, item) ?? humanizeKey(item);
}

function defaultItemLabel(moduleKey: string | null, item: string): string | undefined {
  const labels: Readonly<Record<string, string>> | undefined =
    moduleKey === "documents" ? DOCUMENTS_LABELS : moduleKey === "loading" ? LOADING_LABELS : undefined;
  return labels && Object.hasOwn(labels, item) ? labels[item] : undefined;
}

export interface DefectChoice {
  /** A defect code, or a one-off label. */
  value: string;
  label: string;
}

export interface DefectChoices {
  /** The photo's own defect when the master list does not have it: a one-off label, kept as it is. */
  oneOff: DefectChoice | null;
  /** The module's own defects (those it words), by name, then the rest of the master list. Empty lists left out. */
  groups: { key: "module" | "other"; items: DefectChoice[] }[];
}

/**
 * What a photo in this module can be tagged with, for the edit dialog: the
 * defects the module names, in the template's wording, before the rest of
 * the master list, so a long list opens on the likely few.
 */
export function defectChoices(moduleKey: string | null, current: string, options: PhotoTagOptions): DefectChoices {
  const wording = (moduleKey ? options.defectLabels[moduleKey] : undefined) ?? {};
  const own: DefectChoice[] = [];
  const other: DefectChoice[] = [];
  for (const entry of options.defects) {
    const label = wording[entry.code];
    if (label) own.push({ value: entry.code, label });
    else other.push({ value: entry.code, label: entry.name });
  }
  own.sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
  const known = current === "" || options.defects.some((entry) => entry.code === current);
  return {
    oneOff: known ? null : { value: current, label: defectName(moduleKey, current, options) },
    groups: [
      { key: "module" as const, items: own },
      { key: "other" as const, items: other },
    ].filter((group) => group.items.length > 0),
  };
}

/* ------------------------------------------------------------------ *
 * Display tags
 * ------------------------------------------------------------------ */

/**
 * The tags a tile shows (components/qc PhotoTags). `item` carries the words
 * for the packaging level and the list entry, which the kit's tag line puts
 * last: "Labeling · Size M · Lot no. · Box 253 · Carton Box".
 */
export interface DisplayTags {
  module: string;
  size?: string;
  hand?: string;
  defect?: string;
  box?: string;
  item?: string;
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
  const listed = [
    focus.level !== undefined ? levelName(moduleKey, focus.level, options) : null,
    focus.item !== undefined ? itemName(moduleKey, focus.item, options) : null,
  ].filter((words): words is string => words !== null);
  const tags: DisplayTags = {
    module: moduleTitle(moduleKey, options),
    // The canonical size ("Size M", "Size 7.0"), as on the size tabs.
    size: focus.size,
    hand: focus.hand,
    defect: focus.defect ? defectName(moduleKey, focus.defect, options) : undefined,
    box: focus.box !== undefined ? String(focus.box) : undefined,
    item: listed.length > 0 ? listed.join(" · ") : undefined,
  };
  const hasFocus = Boolean(tags.size || tags.hand || tags.defect || tags.box || tags.item);
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
  if (keys.includes("level") && target.level !== undefined) kept.level = target.level;
  if (keys.includes("item") && target.item !== undefined) kept.item = target.item;
  return kept;
}

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

export interface ModuleGroup<T> {
  /** Media category, module or custom module key; null for photos not tagged yet. */
  key: string | null;
  /** A module's short name, a Media category's title. */
  title: string;
  /** False for a module switched off, or one the template does not know. */
  included: boolean;
  items: T[];
}

/**
 * Items by tag in screen order: Media's categories first (Source Documents
 * is the first step), then the template's included modules, switched-off
 * ones, keys the template does not know (by name), and last the photos not
 * tagged yet. Only groups that hold something.
 */
export function groupByModule<T extends { moduleKey: string | null }>(
  items: readonly T[],
  options: PhotoTagOptions,
): ModuleGroup<T>[] {
  const byKey = new Map<string | null, T[]>();
  for (const item of items) byKey.set(item.moduleKey, [...(byKey.get(item.moduleKey) ?? []), item]);

  const groups: ModuleGroup<T>[] = [];
  for (const entry of [...MEDIA_CATEGORY_OPTIONS, ...options.modules]) {
    const found = byKey.get(entry.key);
    if (!found) continue;
    groups.push({ key: entry.key, title: entry.shortTitle, included: entry.included, items: found });
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

/** Where the photos are, for the gallery's summary: " in 2 categories and 3 modules"; empty while none is tagged. */
export function groupsLine(groups: readonly Pick<ModuleGroup<unknown>, "key">[]): string {
  const tagged = groups.filter((group) => group.key !== null);
  const categories = tagged.filter((group) => isMediaCategoryKey(group.key)).length;
  const modules = tagged.length - categories;
  const parts = [
    categories > 0 ? `${categories} ${categories === 1 ? "category" : "categories"}` : null,
    modules > 0 ? `${modules} ${modules === 1 ? "module" : "modules"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` in ${parts.join(" and ")}` : "";
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const FILE_KIND_LABEL: Readonly<Record<InspectionFileKind, string>> = {
  lab_report: "Lab Report",
  certificate: "Certificate",
  other: "Document",
};

/** What a file is, in a list's words: its kind, or Video for one of Media's videos (kept as kind other). */
export function fileKindLabel(file: { kind: InspectionFileKind | null; name: string }): string {
  if (file.kind === "other" && /\.(mp4|m4v|mov|webm)$/i.test(file.name.trim())) return "Video";
  return file.kind ? FILE_KIND_LABEL[file.kind] : "File";
}

/** "1 photo", "3 photos". */
export function countPhotos(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

/** "1 file", "2 files". */
export function countFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** "1 video", "2 videos". */
export function countVideos(count: number): string {
  return `${count} ${count === 1 ? "video" : "videos"}`;
}
