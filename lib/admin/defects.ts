import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DEFECT_CLASSES, type DefectClass } from "@/lib/coverage/keys";
import type { InspectionStatus } from "@/lib/schemas/common";
import { compareSizes } from "@/lib/sizes";
import type { Database } from "@/lib/supabase/database.types";
import { HAND_LABEL, HANDS, type Hand } from "@/modules/_framework/hands";

/**
 * Defect codes and how labels map to them, for /admin/defects (BUILD_SPEC
 * 4.2 rule 4, 8 and 10): the code forms, each template's labels with the
 * code and severity they map to, the one-off labels inspectors add during
 * capture, and recording an admin's mapping on an inspection's data.
 *
 * Shared by server and browser code (the page's client components use the
 * schemas, the search and the display words), so nothing here imports a
 * server-only module. The queries take the caller's Supabase client: they
 * run with the signed-in admin's rights, so Row Level Security checks them
 * again.
 *
 * Inspection data is read in the canonical shape of docs/DATA_DICTIONARY.md:
 * per-size modules keep `sizes.<size>`, hand split adds `R` and `L`, visual
 * nests its classes; one-off labels are `unmapped: [{ label, count }]` next
 * to the code counts (`counts` in visual, `holes` in watertight), and the
 * watertight report's "Other :" row is `holes.hole_other` with its
 * `otherDescription`.
 */

export type DatabaseClient = SupabaseClient<Database>;
export type TemplateStatus = Database["public"]["Enums"]["template_status"];

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

export const DEFECTS_PATH = "/admin/defects";
export const LABEL_MAPPING_PATH = "/admin/defects/labels";
export const UNMAPPED_PATH = "/admin/defects/unmapped";
export const TEMPLATES_PATH = "/admin/templates";

/** The template editor for one version (BUILD_SPEC 10, /admin/templates). */
export function templateEditorHref(templateId: string): string {
  return `${TEMPLATES_PATH}/${templateId}`;
}

/** An inspection as an admin opens it: the review screen once submitted, the capture screen before. */
export function inspectionHref(id: string, status: InspectionStatus): string {
  return status === "submitted" ? `/inspections/${id}/review` : `/inspections/${id}`;
}

/** The codes tab with the add panel open and filled in, e.g. for a template code that is not a defect code yet. */
export function addCodeHref(code: string, name: string): string {
  const query = new URLSearchParams({ add: code, name });
  return `${DEFECTS_PATH}?${query.toString()}`;
}

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

/** Same rule as the `defect_codes.code` check constraint. */
export const DEFECT_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Longest values the forms take. */
export const LIMITS = { code: 64, name: 120, description: 1000, label: 500 } as const;

export const MESSAGES = {
  stale: "This page is out of date. Reload it and try again.",
  checkFields: "Check the highlighted fields.",
  unexpected: "Something went wrong on the server. Try again, and reload the page if it keeps happening.",
  unreachable: "Could not reach the server. Check the connection and try again.",
  notAllowed: "Only active admins can change defect codes. Reload the page to check your access.",
} as const;

/** One line: any run of spaces, tabs or pasted line breaks becomes a single space. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Several lines: \n line ends, no spaces at line ends, no blank lines at either end. */
export function multiLine(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** What an admin types, as a code: lower case, spaces and hyphens as underscores. "Torn cuff" gives torn_cuff. */
export function normaliseCode(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const nullIfEmpty = (value: string): string | null => (value === "" ? null : value);
const tooLong = (what: string, max: number) => `Keep the ${what} to ${max.toLocaleString("en-GB")} characters or fewer.`;

export const CODE_RULE = "Lower case letters, digits and underscores, starting with a letter, e.g. torn_cuff.";

/** What is wrong with a code, more precisely than the rule the field's hint already shows. */
function codeProblem(code: string): string | null {
  if (code === "" || DEFECT_CODE_PATTERN.test(code)) return null;
  if (!/^[a-z]/.test(code)) return "Start the code with a letter, e.g. torn_cuff.";
  const others = [...new Set(code.replace(/[a-z0-9_]/g, ""))].map((character) => `“${character}”`);
  return `Use only lower case letters, digits and underscores: remove ${others.join(" ")}.`;
}

export const DefectCodeSchema = z
  .string()
  .overwrite(normaliseCode)
  .min(1, "Enter a code.")
  .max(LIMITS.code, tooLong("code", LIMITS.code))
  .superRefine((code, context) => {
    const problem = codeProblem(code);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

/** Name and description: what every code form sends. Empty descriptions are stored as null. */
export const DefectCodeDetailsSchema = z.object({
  name: z.string().overwrite(oneLine).min(1, "Enter a name.").max(LIMITS.name, tooLong("name", LIMITS.name)),
  description: z
    .string()
    .overwrite(multiLine)
    .max(LIMITS.description, tooLong("description", LIMITS.description))
    .transform(nullIfEmpty),
});

/** A new code as the add form sends it. */
export const NewDefectCodeSchema = DefectCodeDetailsSchema.extend({ code: DefectCodeSchema });
export type NewDefectCode = z.output<typeof NewDefectCodeSchema>;

export type DefectCodeField = "code" | "name" | "description";
/** The fields in the order they appear, so the first one with an error takes the focus. */
export const DEFECT_CODE_FIELDS: readonly DefectCodeField[] = ["code", "name", "description"];

/** A code the page sends back to name an existing row. */
export const CodeRefSchema = z.string().regex(DEFECT_CODE_PATTERN, { error: MESSAGES.stale }).max(LIMITS.code);

/** Which code an edit saves, with the version (`updated_at`) the form was opened on. */
export const EditTargetSchema = z.object({
  code: CodeRefSchema,
  version: z.iso.datetime({ offset: true, error: MESSAGES.stale }),
});

export const CodeTargetSchema = z.object({ code: CodeRefSchema });

export const ActiveTargetSchema = z.object({
  code: CodeRefSchema,
  active: z.enum(["true", "false"], { error: MESSAGES.stale }).transform((value) => value === "true"),
});

/** A form's text fields by name. Missing fields and files read as "". */
export function readForm<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  const values = {} as Record<K, string>;
  for (const key of keys) {
    const value = formData.get(key);
    values[key] = typeof value === "string" ? value : "";
  }
  return values;
}

/** The first message for each field, shown under that field. */
export function fieldErrors<T>(error: z.ZodError<T>): Partial<Record<keyof T & string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in result)) result[field] = issue.message;
  }
  return result as Partial<Record<keyof T & string, string>>;
}

/* ------------------------------------------------------------------ *
 * Action results
 * ------------------------------------------------------------------ */

/**
 * What a Server Action on these pages answers. Only display data: it is
 * serialised to the browser. A warning is a partial success, e.g. a new code
 * that was added although the label could not be mapped to it.
 */
export type ActionResult<Field extends string = string> =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "warning"; message: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>> };

export const IDLE = { status: "idle" } as const;

export function succeeded(message: string): { status: "success"; message: string } {
  return { status: "success", message };
}

export function warned(message: string): { status: "warning"; message: string } {
  return { status: "warning", message };
}

export function failed<Field extends string = never>(
  message: string,
  fields?: Partial<Record<Field, string>>,
): { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>> } {
  return fields ? { status: "error", message, fieldErrors: fields } : { status: "error", message };
}

/**
 * Runs a Server Action body. An unexpected failure becomes a message on the
 * form instead of an error page; Next.js redirects and 404s pass through.
 */
export async function guarded<T>(name: string, run: () => Promise<T>): Promise<T | { status: "error"; message: string }> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[admin/defects] ${name} failed`, error);
    return failed(MESSAGES.unexpected);
  }
}

/** For the browser: a Server Action call that never got an answer (dropped Wi-Fi, a new deployment). */
export function unreachable(error: unknown): { status: "error"; message: string } {
  console.error(error);
  return failed(MESSAGES.unreachable);
}

/* ------------------------------------------------------------------ *
 * Database errors in plain words (codes: docs/DATABASE.md)
 * ------------------------------------------------------------------ */

type DatabaseError = { code?: string | null; message?: string | null };

/** A failed insert of a new code. A duplicate or a refused code belongs next to the code field. */
export function describeCodeInsertError(code: string, error: DatabaseError): { message: string; field?: "code" } {
  switch (error.code) {
    case "23505":
      return { field: "code", message: `There is already a code ${code}.` };
    case "23514":
      return { field: "code", message: `Use ${CODE_RULE.charAt(0).toLowerCase()}${CODE_RULE.slice(1)}` };
    case "42501":
      return { message: MESSAGES.notAllowed };
    default:
      return { message: `The code ${code} could not be added. Try again.` };
  }
}

/** A failed update or delete of a code. */
export function describeCodeWriteError(error: DatabaseError, what: "saved" | "deleted"): string {
  if (error.code === "42501") return MESSAGES.notAllowed;
  return `The code could not be ${what}. Try again.`;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** Lower case, accents dropped, single spaces, underscores as spaces: "Thin_Spot" finds "thin spot". */
export function normaliseForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text a row is searched by: its values, normalised once. */
export function searchText(...values: Array<string | null | undefined>): string {
  return normaliseForSearch(values.filter(Boolean).join(" "));
}

/** True when every word of the query appears in the row's search text, in any order. */
export function matchesSearch(text: string, query: string): boolean {
  const terms = normaliseForSearch(query).split(" ").filter(Boolean);
  return terms.every((term) => text.includes(term));
}

/* ------------------------------------------------------------------ *
 * Words on screen
 * ------------------------------------------------------------------ */

export const CLASS_LABEL: Readonly<Record<DefectClass, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export const TEMPLATE_STATUS_LABEL: Readonly<Record<TemplateStatus, string>> = {
  draft: "Draft",
  active: "Active",
  retired: "Retired",
};

/** "STD_EG v2" */
export function templateVersionLabel(template: { code: string; version: number }): string {
  return `${template.code} v${template.version}`;
}

const listFormat = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** "STD_EG v1", "STD_EG v1 and SAFEDON_EG v2", "... and 3 more" after five. */
export function listOf(items: readonly string[], max = 5): string {
  if (items.length <= max) return listFormat.format(items);
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}

/* ------------------------------------------------------------------ *
 * Shared JSON helpers
 * ------------------------------------------------------------------ */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys a path may never name: they reach the object prototype, not the data. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

/** A key of saved data that is safe to follow: own, and not a prototype key. */
function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key);
}

/** An own child object of `parent`, or null. */
function ownRecord(parent: JsonRecord, key: string): JsonRecord | null {
  if (!isSafeKey(key) || !Object.hasOwn(parent, key)) return null;
  const child = parent[key];
  return isRecord(child) ? child : null;
}

/**
 * A saved count: a whole number from 0, with blank (null or missing) as 0.
 * Anything else (text, a fraction, a negative number) is null: not a count.
 */
export function readCount(value: unknown): number | null {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * True when `value` names `code` anywhere: as an object key or as a string
 * value. Errs on the side of "yes" (an unrelated value that happens to equal
 * the code counts too), which is the safe side for "may this be deleted?".
 */
export function mentionsCode(value: unknown, code: string, depth = 0): boolean {
  if (depth > 32) return true;
  if (typeof value === "string") return value === code;
  if (Array.isArray(value)) return value.some((item) => mentionsCode(item, code, depth + 1));
  if (isRecord(value)) {
    return Object.entries(value).some(([key, child]) => key === code || mentionsCode(child, code, depth + 1));
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Template labels (BUILD_SPEC 4.2 rule 4: severity belongs to the template)
 * ------------------------------------------------------------------ */

/** The template config lists that map labels to defect codes, in report order. */
export const LABEL_SECTIONS = ["watertight", "visual", "dispensing_safedon"] as const;
export type LabelSection = (typeof LABEL_SECTIONS)[number];

export const SECTION_TITLE: Readonly<Record<LabelSection, string>> = {
  watertight: "Watertight test: hole locations",
  visual: "Visual inspection",
  dispensing_safedon: "Glove dispensing (Safedon)",
};

/** One label of a template, the code it maps to, and the class (severity) for visual defects. */
export type TemplateLabel = {
  section: LabelSection;
  /** The visual class the template lists the code under: its severity in this template. Null elsewhere. */
  defectClass: DefectClass | null;
  label: string;
  code: string;
};

export type TemplateLabels = {
  labels: TemplateLabel[];
  /** Visual classes the template switches off. */
  classesOff: DefectClass[];
  /** AQL of each visual class that is on, as the template sets it. */
  classAql: Partial<Record<DefectClass, number>>;
};

const ResolvedShapeSchema = z.object({ modules: z.array(z.unknown()) });

const ResolvedModuleShapeSchema = z.object({
  key: z.string(),
  include: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const CodedItemSchema = z.object({ code: z.string().trim().min(1), label: z.string().optional() });

function codedItems(value: unknown): { code: string; label?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = CodedItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The wording a template shows for a code: the label in its config list, or
 * the module's label for the code (most specific first: `minor.bead_defective`,
 * then `bead_defective`), or the code itself.
 */
function wordingOf(item: { code: string; label?: string }, labels: Record<string, string>, group?: string) {
  const own = item.label === undefined ? "" : oneLine(item.label);
  if (own) return own;
  const keyed = (group && labels[`${group}.${item.code}`]) || labels[item.code];
  return keyed?.trim() ? oneLine(keyed) : item.code;
}

/**
 * Every label a resolved template (`templates.resolved`) maps to a defect
 * code: visual defects per class, watertight hole locations and the Safedon
 * dispensing defects, in the template's order. Modules the template switches
 * off are left out. Null when the value is not a resolved template.
 */
export function templateLabels(resolved: unknown): TemplateLabels | null {
  const parsed = ResolvedShapeSchema.safeParse(resolved);
  if (!parsed.success) return null;

  const labels: TemplateLabel[] = [];
  const classesOff: DefectClass[] = [];
  const classAql: Partial<Record<DefectClass, number>> = {};

  for (const raw of parsed.data.modules) {
    const entry = ResolvedModuleShapeSchema.safeParse(raw);
    if (!entry.success || entry.data.include === false) continue;
    const { key, config = {}, labels: wording = {} } = entry.data;

    if (key === "visual") {
      const classes = isRecord(config.classes) ? config.classes : {};
      for (const defectClass of DEFECT_CLASSES) {
        const settings = classes[defectClass];
        if (!isRecord(settings)) continue;
        if (settings.include === false) {
          classesOff.push(defectClass);
          continue;
        }
        if (typeof settings.aql === "number") classAql[defectClass] = settings.aql;
        for (const item of codedItems(settings.defects)) {
          labels.push({ section: "visual", defectClass, code: item.code, label: wordingOf(item, wording, defectClass) });
        }
      }
    } else if (key === "watertight") {
      for (const item of codedItems(config.locations)) {
        labels.push({ section: "watertight", defectClass: null, code: item.code, label: wordingOf(item, wording) });
      }
    } else if (key === "dispensing_safedon") {
      for (const item of codedItems(config.defects)) {
        labels.push({ section: "dispensing_safedon", defectClass: null, code: item.code, label: wordingOf(item, wording) });
      }
    }
  }

  const sectionOrder = (label: TemplateLabel) => LABEL_SECTIONS.indexOf(label.section);
  const classOrder = (label: TemplateLabel) => (label.defectClass ? DEFECT_CLASSES.indexOf(label.defectClass) : -1);
  // Stable: within a section and class the template's own order stays.
  labels.sort((a, b) => sectionOrder(a) - sectionOrder(b) || classOrder(a) - classOrder(b));
  return { labels, classesOff, classAql };
}

/** A template version as the defects pages read it. Server side: it carries the raw JSON. */
export type TemplateRecord = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  name: string;
  /** The resolved template's labels, or null while the version has not resolved. */
  labels: TemplateLabels | null;
  /** The definition and resolution as stored, to tell whether a code is mentioned at all. */
  definition: unknown;
  resolved: unknown;
};

/**
 * The version of each template code that inspectors see now: the active one,
 * else the newest. Sorted by template code.
 */
export function currentVersions<T extends { code: string; version: number; status: TemplateStatus }>(
  rows: readonly T[],
): T[] {
  const byCode = new Map<string, T>();
  for (const row of rows) {
    const held = byCode.get(row.code);
    if (
      !held ||
      (row.status === "active" && held.status !== "active") ||
      (held.status !== "active" && row.status !== "active" && row.version > held.version)
    ) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** A code as the label tables check it: unknown to defect_codes, inactive, or fine. */
export type LabelCodeState = "ok" | "inactive" | "unknown";

export type LabelRow = TemplateLabel & { state: LabelCodeState; codeName: string | null };

/** One template's labels as /admin/defects/labels shows them. Display data only. */
export type TemplateLabelMap = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  name: string;
  /** False while the version has not resolved: its labels cannot be read yet. */
  resolved: boolean;
  sections: { section: LabelSection; rows: LabelRow[] }[];
  classesOff: DefectClass[];
  classAql: Partial<Record<DefectClass, number>>;
  /** Labels whose code is not a defect code, or is inactive. */
  attention: number;
};

type CodeInfo = { code: string; name: string; active: boolean };

/** The current version of every template with its labels checked against the codes. */
export function buildLabelMaps(templates: readonly TemplateRecord[], codes: readonly CodeInfo[]): TemplateLabelMap[] {
  const known = new Map(codes.map((code) => [code.code, code]));
  return currentVersions(templates).map((template) => {
    const rows: LabelRow[] = (template.labels?.labels ?? []).map((label) => {
      const code = known.get(label.code);
      return {
        ...label,
        state: !code ? "unknown" : code.active ? "ok" : "inactive",
        codeName: code?.name ?? null,
      };
    });
    const sections = LABEL_SECTIONS.flatMap((section) => {
      const inSection = rows.filter((row) => row.section === section);
      return inSection.length > 0 ? [{ section, rows: inSection }] : [];
    });
    return {
      id: template.id,
      code: template.code,
      version: template.version,
      status: template.status,
      name: template.name,
      resolved: template.labels !== null,
      sections,
      classesOff: template.labels?.classesOff ?? [],
      classAql: template.labels?.classAql ?? {},
      attention: rows.filter((row) => row.state !== "ok").length,
    };
  });
}

/** How many labels the maps hold. */
export function labelCount(maps: readonly TemplateLabelMap[]): number {
  return maps.reduce((total, map) => total + map.sections.reduce((sum, section) => sum + section.rows.length, 0), 0);
}

/**
 * The maps with only the labels the query finds, by label, code, code name,
 * class, or the template's code and name ("SAFEDON stain"). Templates with no
 * label left are dropped.
 */
export function filterLabelMaps(maps: readonly TemplateLabelMap[], query: string): TemplateLabelMap[] {
  if (!normaliseForSearch(query)) return [...maps];
  return maps.flatMap((map) => {
    const sections = map.sections.flatMap((section) => {
      const rows = section.rows.filter((row) =>
        matchesSearch(
          searchText(map.code, map.name, row.label, row.code, row.codeName, row.defectClass && CLASS_LABEL[row.defectClass]),
          query,
        ),
      );
      return rows.length > 0 ? [{ section: section.section, rows }] : [];
    });
    return sections.length > 0 ? [{ ...map, sections }] : [];
  });
}

/* ------------------------------------------------------------------ *
 * The code list
 * ------------------------------------------------------------------ */

/**
 * The add panel's values from `?add=<code>&name=<label>` (a link from a
 * template label that is not a code yet), or null when there is no code.
 */
export function addPrefill(params: Readonly<Record<string, string | string[] | undefined>>): { code: string; name: string } | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const code = DefectCodeSchema.safeParse(first(params.add) ?? "");
  if (!code.success) return null;
  return { code: code.data, name: oneLine(first(params.name) ?? "").slice(0, LIMITS.name) };
}

export type DefectCodeRow = {
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  updated_at: string;
};

/** One code as the codes tab shows it. Display data only: this reaches the browser. */
export type DefectCodeItem = {
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  /** The row's `updated_at`: the version an edit starts from. */
  updatedAt: string;
  /** Templates whose current version maps a label to it, e.g. ["SAFEDON_EG", "STD_EG"]. */
  usedBy: string[];
  /** Every template version that mentions it, current or not ("STD_EG v1"). Such a code is never deleted. */
  inTemplates: string[];
};

/** Active first, then inactive; each by code. */
function byActiveThenCode(a: DefectCodeRow, b: DefectCodeRow): number {
  return Number(b.active) - Number(a.active) || a.code.localeCompare(b.code);
}

/** The codes with what uses them. */
export function buildCodeItems(codes: readonly DefectCodeRow[], templates: readonly TemplateRecord[]): DefectCodeItem[] {
  const current = currentVersions(templates);
  return [...codes].sort(byActiveThenCode).map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    active: row.active,
    updatedAt: row.updated_at,
    usedBy: current
      .filter((template) => template.labels?.labels.some((label) => label.code === row.code))
      .map((template) => template.code),
    inTemplates: templatesMentioning(templates, row.code),
  }));
}

/** Every template version whose definition or resolution mentions `code`, as "STD_EG v1". */
export function templatesMentioning(templates: readonly TemplateRecord[], code: string): string[] {
  return templates
    .filter((template) => mentionsCode(template.definition, code) || mentionsCode(template.resolved, code))
    .sort((a, b) => a.code.localeCompare(b.code) || a.version - b.version)
    .map(templateVersionLabel);
}

/** Why a code cannot be deleted, or null when no template mentions it. */
export function deleteBlocker(item: Pick<DefectCodeItem, "inTemplates">): string | null {
  if (item.inTemplates.length === 0) return null;
  const verb = item.inTemplates.length === 1 ? "uses" : "use";
  return `${listOf(item.inTemplates)} ${verb} it, so it cannot be deleted. Deactivate it instead.`;
}

/* ------------------------------------------------------------------ *
 * One-off labels in inspection data (BUILD_SPEC 4.2 rule 4, 8)
 * ------------------------------------------------------------------ */

/** The modules whose data can hold one-off labels, in report order. */
export const LABEL_MODULES = ["watertight", "visual"] as const;
export type LabelModule = (typeof LABEL_MODULES)[number];

/**
 * `unmapped`: an inspector's one-off label (`unmapped: [{ label, count }]`).
 * `other`: the watertight report's "Other :" row, counted under hole_other
 * with the location written in `otherDescription`.
 */
export const LABEL_KINDS = ["unmapped", "other"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

/** The hole location of the watertight report's "Other :" row (DATA_DICTIONARY, Defects). */
export const OTHER_HOLE_CODE = "hole_other";

/** Where a module keeps its counts by code, next to its one-off labels. */
export const COUNT_MAP_KEY: Readonly<Record<LabelModule, "holes" | "counts">> = { watertight: "holes", visual: "counts" };

export const MODULE_LABEL: Readonly<Record<LabelModule, string>> = { watertight: "Watertight", visual: "Visual" };

/**
 * How deep below a size's entry labels are looked for: hand and class, in
 * either order, with room for one grouping key a module may add (`classes`).
 */
const MAX_DEPTH = 3;

const DataKeySchema = z
  .string()
  .min(1)
  .max(40)
  .refine(isSafeKey, { error: MESSAGES.stale });

/** Where a one-off label sits in an inspection's data, and what it says. Sent back by the map form. */
export const LabelTargetSchema = z
  .object({
    module: z.enum(LABEL_MODULES),
    kind: z.enum(LABEL_KINDS),
    /** The key under `sizes`, as saved. */
    size: DataKeySchema,
    /** Keys from the size's entry down to the object that holds the label, e.g. ["R", "major"]. */
    path: z.array(DataKeySchema).max(MAX_DEPTH),
    label: z.string().overwrite(oneLine).min(1).max(LIMITS.label),
  })
  .refine((target) => target.kind === "unmapped" || target.module === "watertight", { error: MESSAGES.stale });
export type LabelTarget = z.output<typeof LabelTargetSchema>;

/** A one-off label as found in an inspection's data. */
export type FoundLabel = LabelTarget & {
  hand: Hand | null;
  /** The visual class it was recorded under: its severity. Null for watertight. */
  defectClass: DefectClass | null;
  /** How many, or null when a saved count is not a whole number (the inspection needs fixing first). */
  count: number | null;
};

const isHand = (key: string): key is Hand => (HANDS as readonly string[]).includes(key);
const isDefectClass = (key: string): key is DefectClass => (DEFECT_CLASSES as readonly string[]).includes(key);

/**
 * Every one-off label in an inspection's data: visual and watertight
 * `unmapped` lists, and watertight "Other :" locations. The same label twice
 * in one list is one entry with the counts added. Sorted in report order:
 * module, size, hand, class.
 */
export function findOneOffLabels(data: unknown): FoundLabel[] {
  const modules = isRecord(data) ? ownRecord(data, "modules") : null;
  if (!modules) return [];

  const found: FoundLabel[] = [];
  for (const moduleKey of LABEL_MODULES) {
    const sizes = ownRecord(ownRecord(modules, moduleKey) ?? {}, "sizes");
    if (!sizes) continue;
    for (const size of Object.keys(sizes)) {
      const entry = ownRecord(sizes, size);
      if (entry && size.length <= 40) walk(entry, [], (holder, path) => collect(holder, path, moduleKey, size, found));
    }
  }
  return found.sort(compareFound);
}

function walk(node: JsonRecord, path: string[], visit: (holder: JsonRecord, path: string[]) => void): void {
  visit(node, path);
  if (path.length >= MAX_DEPTH) return;
  for (const key of Object.keys(node)) {
    if (key === "unmapped" || key === "counts" || key === "holes" || key.length > 40) continue;
    const child = ownRecord(node, key);
    if (child) walk(child, [...path, key], visit);
  }
}

function collect(holder: JsonRecord, path: string[], moduleKey: LabelModule, size: string, out: FoundLabel[]): void {
  const hand = path.find(isHand) ?? null;
  const defectClass = moduleKey === "visual" ? (path.find(isDefectClass) ?? null) : null;
  const place = { module: moduleKey, size, path, hand, defectClass };

  const list = Object.hasOwn(holder, "unmapped") ? holder.unmapped : undefined;
  if (Array.isArray(list)) {
    const counts = new Map<string, number | null>();
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.label !== "string") continue;
      const label = oneLine(entry.label);
      if (!label || label.length > LIMITS.label) continue;
      const count = readCount(entry.count);
      const before = counts.has(label) ? (counts.get(label) ?? null) : 0;
      counts.set(label, before === null || count === null ? null : before + count);
    }
    for (const [label, count] of counts) out.push({ ...place, kind: "unmapped", label, count });
  }

  if (moduleKey === "watertight" && Object.hasOwn(holder, "otherDescription") && typeof holder.otherDescription === "string") {
    const label = oneLine(holder.otherDescription);
    if (label && label.length <= LIMITS.label) {
      const holes = Object.hasOwn(holder, "holes") ? holder.holes : undefined;
      const count = holes === undefined || holes === null ? 0 : isRecord(holes) ? readCount(holes[OTHER_HOLE_CODE]) : null;
      out.push({ ...place, defectClass: null, kind: "other", label, count });
    }
  }
}

function compareFound(a: FoundLabel, b: FoundLabel): number {
  const handRank = (hand: Hand | null) => (hand === null ? -1 : HANDS.indexOf(hand));
  const classRank = (defectClass: DefectClass | null) => (defectClass === null ? -1 : DEFECT_CLASSES.indexOf(defectClass));
  return (
    LABEL_MODULES.indexOf(a.module) - LABEL_MODULES.indexOf(b.module) ||
    compareSizes(a.size, b.size) ||
    handRank(a.hand) - handRank(b.hand) ||
    classRank(a.defectClass) - classRank(b.defectClass) ||
    LABEL_KINDS.indexOf(a.kind) - LABEL_KINDS.indexOf(b.kind) ||
    a.label.localeCompare(b.label)
  );
}

/** "Visual · Major", "Watertight", "Watertight · Other" (the report's "Other :" row) */
export function whereLabel(label: Pick<FoundLabel, "module" | "kind" | "defectClass">): string {
  const parts: string[] = [MODULE_LABEL[label.module]];
  if (label.defectClass) parts.push(CLASS_LABEL[label.defectClass]);
  if (label.kind === "other") parts.push("Other");
  return parts.join(" · ");
}

/** "Size M", "Size 7.0 · Right hand" */
export function sizeLabel(label: Pick<FoundLabel, "size" | "hand">): string {
  return label.hand ? `Size ${label.size} · ${HAND_LABEL[label.hand]}` : `Size ${label.size}`;
}

/** "2 found", "1 hole" */
export function countLabel(label: Pick<FoundLabel, "module" | "count">): string {
  if (label.count === null) return "Count unreadable";
  if (label.module === "watertight") return `${label.count} ${label.count === 1 ? "hole" : "holes"}`;
  return `${label.count} found`;
}

/* ------------------------------------------------------------------ *
 * Recording a mapping on an inspection's data
 * ------------------------------------------------------------------ */

export type MappingProblem = "not_found" | "invalid_count" | "same_code" | "invalid_data";

/** What a mapping did, for the audit log and the message. */
export type MappingChange = {
  module: LabelModule;
  kind: LabelKind;
  size: string;
  hand: Hand | null;
  defectClass: DefectClass | null;
  label: string;
  count: number;
  code: string;
};

export type MappingOutcome =
  | { ok: true; data: JsonRecord; change: MappingChange }
  | { ok: false; problem: MappingProblem };

/** The object a target points at, inside data that is already a copy. */
function holderOf(data: JsonRecord, target: LabelTarget): JsonRecord | null {
  let node = ownRecord(ownRecord(ownRecord(data, "modules") ?? {}, target.module) ?? {}, "sizes");
  for (const key of [target.size, ...target.path]) {
    if (!node) return null;
    node = ownRecord(node, key);
  }
  return node;
}

/** The count map next to a label, created when it is missing; null when something else is saved there. */
function countMapOf(holder: JsonRecord, key: "holes" | "counts"): JsonRecord | null {
  if (!Object.hasOwn(holder, key) || holder[key] === null || holder[key] === undefined) {
    holder[key] = {};
  }
  const map = holder[key];
  return isRecord(map) ? map : null;
}

/**
 * Records that a one-off label is `code` (BUILD_SPEC 4.2 rule 4): the label
 * leaves the module's `unmapped` list and its count joins `code` in the count
 * map beside it (`counts` in visual, `holes` in watertight), in the same
 * size, hand and class, so it counts with that code from then on. A
 * watertight "Other :" location moves its count from hole_other to `code`
 * and its description is cleared. Totals do not change: one-off labels
 * already count towards them.
 *
 * Pure: returns new data and never changes `data`.
 */
export function mapOneOffLabel(data: unknown, target: LabelTarget, code: string): MappingOutcome {
  if (!isRecord(data)) return { ok: false, problem: "invalid_data" };
  const copy = structuredClone(data);
  const holder = holderOf(copy, target);
  if (!holder) return { ok: false, problem: "not_found" };

  const path = target.path;
  const change = {
    module: target.module,
    kind: target.kind,
    size: target.size,
    hand: path.find(isHand) ?? null,
    defectClass: target.module === "visual" ? (path.find(isDefectClass) ?? null) : null,
    label: target.label,
    code,
  };
  const mapKey = COUNT_MAP_KEY[target.module];

  if (target.kind === "unmapped") {
    const list = Object.hasOwn(holder, "unmapped") ? holder.unmapped : undefined;
    if (!Array.isArray(list)) return { ok: false, problem: "not_found" };
    const matches = (entry: unknown) =>
      isRecord(entry) && typeof entry.label === "string" && oneLine(entry.label) === target.label;
    const matching = list.filter(matches);
    if (matching.length === 0) return { ok: false, problem: "not_found" };

    let total = 0;
    for (const entry of matching) {
      const count = readCount((entry as JsonRecord).count);
      if (count === null) return { ok: false, problem: "invalid_count" };
      total += count;
    }
    if (total > 0) {
      const map = countMapOf(holder, mapKey);
      if (!map) return { ok: false, problem: "invalid_data" };
      const current = readCount(Object.hasOwn(map, code) ? map[code] : undefined);
      if (current === null) return { ok: false, problem: "invalid_count" };
      map[code] = current + total;
    }
    holder.unmapped = list.filter((entry) => !matches(entry));
    return { ok: true, data: copy, change: { ...change, count: total } };
  }

  // The watertight "Other :" row.
  if (target.module !== "watertight") return { ok: false, problem: "not_found" };
  const description = Object.hasOwn(holder, "otherDescription") ? holder.otherDescription : undefined;
  if (typeof description !== "string" || oneLine(description) !== target.label) return { ok: false, problem: "not_found" };
  if (code === OTHER_HOLE_CODE) return { ok: false, problem: "same_code" };

  const holes = Object.hasOwn(holder, "holes") ? holder.holes : undefined;
  if (holes !== undefined && holes !== null && !isRecord(holes)) return { ok: false, problem: "invalid_data" };
  const other = isRecord(holes) ? readCount(holes[OTHER_HOLE_CODE]) : 0;
  if (other === null) return { ok: false, problem: "invalid_count" };
  if (other > 0) {
    const map = countMapOf(holder, "holes");
    if (!map) return { ok: false, problem: "invalid_data" };
    const current = readCount(Object.hasOwn(map, code) ? map[code] : undefined);
    if (current === null) return { ok: false, problem: "invalid_count" };
    map[code] = current + other;
    map[OTHER_HOLE_CODE] = 0;
  }
  holder.otherDescription = null;
  return { ok: true, data: copy, change: { ...change, count: other } };
}

/** A mapping that could not be recorded, in plain words. */
export function describeMappingProblem(problem: MappingProblem, refNo: string): string {
  switch (problem) {
    case "not_found":
      return `This label is no longer on ${refNo}: someone has mapped or changed it. Reload the page.`;
    case "invalid_count":
      return `A count on ${refNo} is not a whole number, so the label cannot be mapped. Fix it on the inspection first.`;
    case "same_code":
      return "This hole is already counted as Hole, other location. Choose another code.";
    case "invalid_data":
      return `The saved data of ${refNo} is not in the expected shape, so the label cannot be mapped.`;
  }
}

/* ------------------------------------------------------------------ *
 * Choosing a code for a label
 * ------------------------------------------------------------------ */

/** Words that say nothing about which defect it is. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "and",
  "area",
  "body",
  "defect",
  "defects",
  "for",
  "from",
  "glove",
  "gloves",
  "other",
  "the",
  "with",
]);

/** Distinct words of three letters or more, without a plural s: "Defective beads" gives defective, bead. */
function wordsOf(text: string): Set<string> {
  const words = normaliseForSearch(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
  return new Set(words);
}

export type CodeChoice = { code: string; name: string; description: string | null };

/**
 * Up to `limit` codes a one-off label probably means, best first: the most
 * words shared with the code and its name (a word only its description or a
 * template's label for it has counts half), then the codes the template
 * lists in the same place, then the closest name ("Stain" before "Small dirt
 * or stain" for "stain").
 */
export function suggestCodes(
  label: string,
  codes: readonly CodeChoice[],
  { preferred = [], wording = new Map(), limit = 5 }: {
    preferred?: readonly string[];
    wording?: ReadonlyMap<string, readonly string[]>;
    limit?: number;
  } = {},
): string[] {
  const wanted = wordsOf(label);
  if (wanted.size === 0) return [];
  const preferredSet = new Set(preferred);
  const scored = codes.flatMap((choice) => {
    const own = wordsOf(`${choice.code} ${choice.name}`);
    const more = wordsOf([choice.description ?? "", ...(wording.get(choice.code) ?? [])].join(" "));
    let score = 0;
    let matched = 0;
    for (const word of wanted) {
      if (own.has(word)) {
        score += 1;
        matched += 1;
      } else if (more.has(word)) {
        score += 0.5;
      }
    }
    if (score === 0) return [];
    return [{ ...choice, score, preferred: preferredSet.has(choice.code), extra: own.size - matched }];
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.preferred) - Number(a.preferred) ||
        a.extra - b.extra ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((choice) => choice.code);
}

/**
 * A code for a one-off label: its words in snake case, "hole_" first for a
 * watertight label, and a number after it when the code is taken.
 */
export function suggestNewCode(label: string, moduleKey: LabelModule, taken: ReadonlySet<string>): string {
  let base = normaliseForSearch(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "defect";
  if (!/^[a-z]/.test(base)) base = `defect_${base}`;
  if (moduleKey === "watertight" && !base.startsWith("hole")) base = `hole_${base}`;
  base = base.slice(0, LIMITS.code).replace(/_+$/, "");
  let candidate = base;
  for (let number = 2; taken.has(candidate); number++) {
    const suffix = `_${number}`;
    candidate = `${base.slice(0, LIMITS.code - suffix.length).replace(/_+$/, "")}${suffix}`;
  }
  return candidate;
}

/* ------------------------------------------------------------------ *
 * The map form
 * ------------------------------------------------------------------ */

export const MAP_FIELDS = ["code", "newCode", "name", "description"] as const;
export type MapField = (typeof MAP_FIELDS)[number];

/** The label a map form names: its inspection and where it sits, as the page saw them. */
export const MapTargetSchema = z.object({
  inspectionId: z.guid({ error: MESSAGES.stale }),
  target: z
    .string()
    .max(4000)
    .transform((raw, context) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: MESSAGES.stale });
        return z.NEVER;
      }
    })
    .pipe(LabelTargetSchema),
});

/** Map to a code that exists. */
export const MapToExistingSchema = z.object({
  mode: z.literal("existing"),
  code: z.string().regex(DEFECT_CODE_PATTERN, "Choose a code.").max(LIMITS.code),
});

/** Add a code for the label and map the label to it. */
export const MapToNewSchema = z.object({
  mode: z.literal("new"),
  newCode: DefectCodeSchema,
  name: DefectCodeDetailsSchema.shape.name,
  description: DefectCodeDetailsSchema.shape.description,
});

export const MapChoiceSchema = z.discriminatedUnion("mode", [MapToExistingSchema, MapToNewSchema], {
  error: MESSAGES.stale,
});

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/** PostgREST answers at most this many rows per request on Supabase; pages stay well below it. */
const PAGE = 500;

/** Every row of a query, page by page. `page(from, to)` builds the query afresh each time. */
async function selectAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Every defect code. */
export async function loadDefectCodes(supabase: DatabaseClient): Promise<DefectCodeRow[]> {
  return selectAll("the defect codes", (from, to) =>
    supabase.from("defect_codes").select("code, name, description, active, updated_at").order("code").range(from, to),
  );
}

/** One defect code, or null when it does not exist. */
export async function readDefectCode(supabase: DatabaseClient, code: string): Promise<DefectCodeRow | null> {
  const { data, error } = await supabase
    .from("defect_codes")
    .select("code, name, description, active, updated_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`Could not read defect code ${code}: ${error.message}`);
  return data;
}

type TemplateQueryRow = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  definition: unknown;
  resolved: unknown;
};

function nameOf(row: TemplateQueryRow): string {
  for (const source of [row.resolved, row.definition]) {
    if (isRecord(source) && typeof source.name === "string" && source.name.trim()) return oneLine(source.name);
  }
  return row.code;
}

/** Every template version with its labels. */
export async function loadTemplates(supabase: DatabaseClient): Promise<TemplateRecord[]> {
  const rows = await selectAll<TemplateQueryRow>("the templates", (from, to) =>
    supabase
      .from("templates")
      .select("id, code, version, status, definition, resolved")
      .order("code")
      .order("version")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    name: nameOf(row),
    labels: row.resolved === null ? null : templateLabels(row.resolved),
    definition: row.definition,
    resolved: row.resolved,
  }));
}

/** Inspections whose data an admin may still change: everything but approved, which is final. */
export const OPEN_STATUSES = ["draft", "submitted", "reopened"] as const satisfies readonly InspectionStatus[];

/** Only a submitted inspection is mapped: drafts and reopened ones are still the inspector's to change. */
export function canMap(status: InspectionStatus): boolean {
  return status === "submitted";
}

/** A one-off label as the unmapped tab shows it. */
export type OneOffLabel = FoundLabel & {
  /** Unique on the page: inspection and place. */
  id: string;
  /** Codes it probably means, best first. */
  suggestions: string[];
  /** A code for "add as a new code". */
  newCode: string;
};

/** An open inspection with one-off labels. Display data only. */
export type InspectionLabels = {
  id: string;
  refNo: string;
  status: InspectionStatus;
  inspectionDate: string;
  inspector: string | null;
  template: { id: string; code: string; version: number } | null;
  labels: OneOffLabel[];
};

/** An open inspection as read for its one-off labels: only the visual and watertight parts of its data. */
export type InspectionQueryRow = {
  id: string;
  ref_no: string;
  status: InspectionStatus;
  inspection_date: string;
  template_id: string;
  inspector: { full_name: string | null; email: string | null } | null;
  visual: unknown;
  watertight: unknown;
};

/** Statuses in the order the unmapped tab lists them: what can be mapped now first. */
const STATUS_ORDER: readonly InspectionStatus[] = ["submitted", "reopened", "draft", "approved"];

/** Open inspections (not approved), newest first, with the visual and watertight parts of their data. */
export async function loadOpenInspections(supabase: DatabaseClient): Promise<InspectionQueryRow[]> {
  return selectAll<InspectionQueryRow>("the inspections", (from, to) =>
    supabase
      .from("inspections")
      .select(
        "id, ref_no, status, inspection_date, template_id, inspector:profiles!inspections_inspector_id_fkey(full_name, email), visual:data->modules->visual, watertight:data->modules->watertight",
      )
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
      .overrideTypes<InspectionQueryRow[], { merge: false }>(),
  );
}

/**
 * The inspections with one-off labels, the ones that can be mapped first,
 * then in the order given (newest first), each label with the codes it
 * probably means and a code for adding it as a new one.
 */
export function buildInspectionLabels(
  rows: readonly InspectionQueryRow[],
  { codes, templates }: { codes: readonly DefectCodeRow[]; templates: readonly TemplateRecord[] },
): InspectionLabels[] {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const active = codes.filter((code) => code.active);
  const taken = new Set(codes.map((code) => code.code));
  // Every label templates give each code, so "Oil stain" suggests stain.
  const wording = new Map<string, string[]>();
  for (const template of templates) {
    for (const label of template.labels?.labels ?? []) wording.set(label.code, [...(wording.get(label.code) ?? []), label.label]);
  }

  const result: InspectionLabels[] = [];
  for (const row of rows) {
    const found = findOneOffLabels({ modules: { visual: row.visual, watertight: row.watertight } });
    if (found.length === 0) continue;
    const template = templateById.get(row.template_id) ?? null;
    const labels = found.map((label): OneOffLabel => {
      const preferred = (template?.labels?.labels ?? [])
        .filter((entry) =>
          label.module === "visual"
            ? entry.section === "visual" && entry.defectClass === label.defectClass
            : entry.section === "watertight",
        )
        .map((entry) => entry.code);
      return {
        ...label,
        id: [row.id, label.module, label.kind, label.size, ...label.path, label.label].join("|"),
        suggestions: suggestCodes(label.label, active, { preferred, wording }),
        newCode: suggestNewCode(label.label, label.module, taken),
      };
    });
    result.push({
      id: row.id,
      refNo: row.ref_no,
      status: row.status,
      inspectionDate: row.inspection_date,
      inspector: row.inspector ? row.inspector.full_name?.trim() || row.inspector.email?.trim() || null : null,
      template: template ? { id: template.id, code: template.code, version: template.version } : null,
      labels,
    });
  }
  // Stable: newest first within each status.
  return result.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}

/**
 * How many one-off labels wait for an admin now: `unmapped` ones on submitted
 * inspections. "Other :" holes already have a code, and a draft's or a
 * reopened inspection's labels are still the inspector's.
 */
export function countUnmapped(inspections: readonly InspectionLabels[]): number {
  return inspections
    .filter((inspection) => canMap(inspection.status))
    .reduce((total, inspection) => total + inspection.labels.filter((label) => label.kind === "unmapped").length, 0);
}

/**
 * The ref number of an inspection, approved ones included, whose data counts
 * `code`, or null. Reads only the modules that count defect codes.
 */
export async function inspectionCountingCode(supabase: DatabaseClient, code: string): Promise<string | null> {
  type Row = { ref_no: string; visual: unknown; watertight: unknown; dispensing: unknown };
  const rows = await selectAll<Row>("the inspections", (from, to) =>
    supabase
      .from("inspections")
      .select(
        "ref_no, visual:data->modules->visual, watertight:data->modules->watertight, dispensing:data->modules->dispensing_safedon",
      )
      .order("created_at")
      .order("id")
      .range(from, to)
      .overrideTypes<Row[], { merge: false }>(),
  );
  const hit = rows.find((row) => [row.visual, row.watertight, row.dispensing].some((part) => mentionsCode(part, code)));
  return hit?.ref_no ?? null;
}

/** What every defects tab reads: the codes, every template version and the open inspections' one-off labels. */
export type DefectsData = {
  codes: DefectCodeRow[];
  templates: TemplateRecord[];
  inspections: InspectionLabels[];
};

/** The three reads run side by side; the labels are matched with the codes and templates afterwards. */
export async function loadDefectsData(supabase: DatabaseClient): Promise<DefectsData> {
  const [codes, templates, rows] = await Promise.all([
    loadDefectCodes(supabase),
    loadTemplates(supabase),
    loadOpenInspections(supabase),
  ]);
  return { codes, templates, inspections: buildInspectionLabels(rows, { codes, templates }) };
}

/** The counts the tab row shows. */
export type DefectsCounts = { codes: number; attention: number; unmapped: number };

export function defectsCounts(data: DefectsData, maps: readonly TemplateLabelMap[] = buildLabelMaps(data.templates, data.codes)): DefectsCounts {
  return {
    codes: data.codes.length,
    attention: maps.reduce((total, map) => total + map.attention, 0),
    unmapped: countUnmapped(data.inspections),
  };
}
