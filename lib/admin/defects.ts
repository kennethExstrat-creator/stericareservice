import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Snapshot } from "@/lib/admin/reference";
import { DEFECT_CLASSES, type DefectClass } from "@/lib/coverage/keys";
import { formatSizeHand, type SizeOption } from "@/lib/format";
import type { InspectionStatus } from "@/lib/schemas/common";
import { ResolvedTemplateSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { normaliseSize } from "@/lib/sizes";
import type { Database } from "@/lib/supabase/database.types";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates/overrides";
import { buildInspectionContext } from "@/modules/_framework/context";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { HANDS, isHandSplit, type Hand } from "@/modules/_framework/hands";
import { labelFor } from "@/modules/_framework/labels";

/**
 * Defect codes and how labels map to them, for /admin/defects (BUILD_SPEC
 * 4.2 rule 4, 8 and 10): the code forms, each template's labels with the
 * code and severity they map to, the one-off labels inspectors add during
 * capture, and recording an admin's mapping on an inspection's data.
 *
 * Shared by server and browser code (the page's client components use the
 * schemas, the search and the display words), so nothing here imports a
 * server-only module, nor the module registry: the server passes it in.
 * The queries take the caller's Supabase client: they run with the
 * signed-in admin's rights, so Row Level Security checks them again.
 *
 * Inspection data is read in the canonical shape of docs/DATA_DICTIONARY.md,
 * and only where the inspection counts it, as the visual and watertight
 * calcs read it (labelScope): the ordered sizes (BUILD_SPEC 6.2 rule 4),
 * the hand layout the template uses (`R` and `L` with handSplit on, the size
 * itself without) and the visual classes it switches on. One-off labels are
 * `unmapped: [{ label, count }]` next to the code counts (`counts` in
 * visual, `holes` in watertight), and the watertight report's "Other :" row
 * is `holes.hole_other` with its `otherDescription`. A one-off label is one
 * label per inspection and visual class, whatever size and hand it was
 * counted in, as the capture screen shows it: it is listed and mapped once.
 */

export type DatabaseClient = SupabaseClient<Database>;
export type TemplateStatus = Database["public"]["Enums"]["template_status"];

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

export const DEFECTS_PATH = "/admin/defects";
export const LABEL_MAPPING_PATH = "/admin/defects/labels";
export const UNMAPPED_PATH = "/admin/defects/unmapped";
/** What inspectors write on paper, each defect linked to its codes (lib/admin/shortforms.ts). */
export const SHORTFORMS_PATH = "/admin/defects/shortforms";
export const TEMPLATES_PATH = "/admin/templates";

/** The template editor for one version (BUILD_SPEC 10): /admin/templates/<version id>/edit. */
export function templateEditorHref(templateId: string): string {
  return `${TEMPLATES_PATH}/${templateId}/edit`;
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

/** The fields an edit saves. The code itself never changes. */
export type CodeDetailField = "name" | "description";

/**
 * A code's name and description as the edit form shows them, at one version
 * (`updated_at`). The edit panel saves against the version it opened on and
 * follows a newer one only when these are unchanged (followVersion in
 * lib/admin/reference.ts), so a save never replaces someone else's edit.
 */
export type CodeSnapshot = Snapshot<CodeDetailField>;

export function codeSnapshot(code: { updatedAt: string; name: string; description: string | null }): CodeSnapshot {
  return { version: code.updatedAt, values: { name: code.name, description: code.description ?? "" } };
}

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
 * that was added although the label could not be mapped to it. `latest` is
 * the row as it is now, when a save was refused over someone else's change.
 */
export type ActionResult<Field extends string = string, Latest = never> =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "warning"; message: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<Field, string>>; latest?: Latest };

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
  watertight: "Watertight Test: Hole Locations",
  visual: "Visual Inspection",
  dispensing_safedon: "Glove Dispensing (Safedon)",
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
  /**
   * AQL of each visual class that is on, as the template sets it; null when
   * it leaves it to the client (else BUILD_SPEC 7's default, AQL_DEFAULTS).
   */
  classAql: Partial<Record<DefectClass, number | null>>;
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
 * A code's label in a config list, on one line. Without one: the template's
 * label for the code (most specific first: `minor.bead_defective`, then
 * `bead_defective`), else the code itself.
 */
function listWording(item: { code: string; label?: string }, labels: Record<string, string>, group?: string): string {
  const own = item.label === undefined ? "" : oneLine(item.label);
  if (own) return own;
  const keyed = group ? labelFor(labels, group, item.code) : labelFor(labels, item.code);
  return oneLine(keyed) || item.code;
}

/**
 * The wording the visual and watertight modules show for a code (their
 * defectLabel and effectiveLocations; docs/MODULES.md section 6): the
 * template's labels reword it for the class (`minor.bead_defective`) or
 * everywhere (`bead_defective`) without rewriting the list; otherwise the
 * list's own label stands.
 */
function moduleWording(item: { code: string; label?: string }, labels: Record<string, string>, group?: string): string {
  // labelFor gives the code itself when the labels do not word it.
  const own = group ? labelFor(labels, group, item.code) : labelFor(labels, item.code);
  return own === item.code ? listWording(item, {}) : oneLine(own);
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
  const classAql: Partial<Record<DefectClass, number | null>> = {};

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
        classAql[defectClass] = typeof settings.aql === "number" ? settings.aql : null;
        for (const item of codedItems(settings.defects)) {
          labels.push({ section: "visual", defectClass, code: item.code, label: moduleWording(item, wording, defectClass) });
        }
      }
    } else if (key === "watertight") {
      for (const item of codedItems(config.locations)) {
        labels.push({ section: "watertight", defectClass: null, code: item.code, label: moduleWording(item, wording) });
      }
    } else if (key === "dispensing_safedon") {
      // That module words its rows from its config list.
      for (const item of codedItems(config.defects)) {
        labels.push({ section: "dispensing_safedon", defectClass: null, code: item.code, label: listWording(item, wording) });
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
  classAql: Partial<Record<DefectClass, number | null>>;
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
  /** The shortforms that count under it, e.g. ["BF"]. Such a code is never deleted either. */
  shortforms: string[];
};

/** Active first, then inactive; each by code. */
function byActiveThenCode(a: DefectCodeRow, b: DefectCodeRow): number {
  return Number(b.active) - Number(a.active) || a.code.localeCompare(b.code);
}

/** A shortform as the code list reads it: what is written, and the codes it counts under (lib/schemas/ai-settings.ts). */
export type LinkedShortform = { short: string; codes: readonly string[] };

const byShortform = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** The shortforms that count under each code, in shortform order: IB under both bead_defective and bead_poor. */
export function shortformsByCode(entries: readonly LinkedShortform[]): Map<string, string[]> {
  const byCode = new Map<string, string[]>();
  for (const entry of [...entries].sort((a, b) => byShortform.compare(a.short, b.short))) {
    for (const code of entry.codes) byCode.set(code, [...(byCode.get(code) ?? []), entry.short]);
  }
  return byCode;
}

/** The codes with what uses them: templates, and the shortforms linked to them (`glossary`). */
export function buildCodeItems(
  codes: readonly DefectCodeRow[],
  templates: readonly TemplateRecord[],
  glossary: readonly LinkedShortform[] = [],
): DefectCodeItem[] {
  const current = currentVersions(templates);
  const linked = shortformsByCode(glossary);
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
    shortforms: linked.get(row.code) ?? [],
  }));
}

/** Every template version whose definition or resolution mentions `code`, as "STD_EG v1". */
export function templatesMentioning(templates: readonly TemplateRecord[], code: string): string[] {
  return templates
    .filter((template) => mentionsCode(template.definition, code) || mentionsCode(template.resolved, code))
    .sort((a, b) => a.code.localeCompare(b.code) || a.version - b.version)
    .map(templateVersionLabel);
}

/** Why a code cannot be deleted, or null when no template mentions it and no shortform links it. */
export function deleteBlocker(item: Pick<DefectCodeItem, "inTemplates" | "shortforms">): string | null {
  const { inTemplates, shortforms } = item;
  const one = shortforms.length === 1;
  if (inTemplates.length === 0) {
    if (shortforms.length === 0) return null;
    return `The ${one ? "shortform" : "shortforms"} ${listOf(shortforms)} ${one ? "uses" : "use"} it, so it cannot be deleted. Change ${one ? "it" : "them"} on Shortforms first, or deactivate the code.`;
  }
  if (shortforms.length === 0) {
    return `${listOf(inTemplates)} ${inTemplates.length === 1 ? "uses" : "use"} it, so it cannot be deleted. Deactivate it instead.`;
  }
  // "STD_EG v1 and the shortform BF use it"; a long list of versions is cut short before the shortforms, never after.
  const versions =
    inTemplates.length <= 4 ? inTemplates : [...inTemplates.slice(0, 3), `${inTemplates.length - 3} more template versions`];
  const users = [...versions, `the ${one ? "shortform" : "shortforms"} ${listOf(shortforms)}`];
  return `${listOf(users)} use it, so it cannot be deleted. Deactivate it instead.`;
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

/** The longest "Other :" description a module saves (lib/validation's TextCellSchema). */
const OTHER_DESCRIPTION_MAX = 2000;

/**
 * What an inspection counts of its watertight and visual data, as their
 * calcs read it: the ordered sizes (BUILD_SPEC 6.2 rule 4; the inspection
 * context's, in the template's order), the hand layout each module uses,
 * and the visual classes switched on. A module switched off, by the template
 * or for this inspection (BUILD_SPEC 4.4), is null: it counts nothing. Data
 * outside the scope stays saved but counts nowhere, so the defects pages
 * neither list nor map it.
 */
export type LabelScope = {
  sizes: readonly string[];
  watertight: { handSplit: boolean } | null;
  visual: { handSplit: boolean; classes: readonly DefectClass[] } | null;
};

/** A template version as stored (`templates.resolved`), or null when it cannot be read. */
export function readResolvedTemplate(resolved: unknown): ResolvedTemplate | null {
  const parsed = ResolvedTemplateSchema.safeParse(resolved);
  return parsed.success ? parsed.data : null;
}

/**
 * Where an inspection made with `template` counts one-off labels. The
 * ordered sizes come from the inspection context, which order_lots gives
 * through the module contract (`registry`); the hand layout and the classes
 * from the template, with the inspection's module overrides applied.
 */
export function labelScope(
  template: ResolvedTemplate,
  inspection: { moduleOverrides: unknown; data: unknown },
  registry: ModuleRegistry,
): LabelScope {
  const effective = applyModuleOverrides(template, parseModuleOverrides(inspection.moduleOverrides));
  const modules = (isRecord(inspection.data) && ownRecord(inspection.data, "modules")) || {};
  const { sizes } = buildInspectionContext({ template: effective, data: { modules, custom: {} } }, registry);
  const settings = (key: LabelModule) => {
    const entry = effective.modules.find((module) => module.key === key);
    return entry?.include ? { handSplit: isHandSplit(registry[key], entry.config), config: entry.config } : null;
  };
  const watertight = settings("watertight");
  const visual = settings("visual");
  const classes = (visual && isRecord(visual.config.classes) && visual.config.classes) || {};
  return {
    sizes,
    watertight: watertight && { handSplit: watertight.handSplit },
    visual: visual && {
      handSplit: visual.handSplit,
      // As templateLabels reads them: a class the template does not set up, or switches off, counts nothing.
      classes: DEFECT_CLASSES.filter((defectClass) => {
        const setting = ownRecord(classes, defectClass);
        return setting !== null && setting.include !== false;
      }),
    },
  };
}

/**
 * One-off labels compare as the capture screen compares them, without case
 * or extra spaces: "Torn cuff" in size M and "torn  cuff" in size L are one
 * label, shown as one row there.
 */
export function labelKey(label: string): string {
  return oneLine(label).toLowerCase();
}

/**
 * A one-off label as the map form names it: where it was recorded (the
 * module, the kind, and the visual class, which is its severity) and its
 * words. Mapping takes it in every size and hand it was recorded in.
 */
export const LabelTargetSchema = z
  .object({
    module: z.enum(LABEL_MODULES),
    kind: z.enum(LABEL_KINDS),
    /** The visual class it was recorded under. Null for watertight. */
    defectClass: z.enum(DEFECT_CLASSES).nullable(),
    label: z.string().overwrite(oneLine).min(1).max(LIMITS.label),
  })
  .refine((target) => (target.module === "visual") === (target.defectClass !== null), { error: MESSAGES.stale })
  .refine((target) => target.kind === "unmapped" || target.module === "watertight", { error: MESSAGES.stale });
export type LabelTarget = z.output<typeof LabelTargetSchema>;

/** A size (and hand) a label was found in. */
export type LabelPlace = {
  /** An ordered size, canonical (its data may be saved under another spelling). */
  size: string;
  hand: Hand | null;
  /** How many there, or null when a saved count is not a whole number. */
  count: number | null;
};

/** A one-off label as found in an inspection's data, with every place it was found. */
export type FoundLabel = LabelTarget & {
  /** In the template's size order; right hand before left. Never a place where it was counted 0. */
  places: LabelPlace[];
  /** Every place together, or null when a count is unreadable (the inspection needs fixing first). */
  count: number | null;
};

const handRank = (hand: Hand | null) => (hand === null ? -1 : HANDS.indexOf(hand));
const classRank = (defectClass: DefectClass | null) => (defectClass === null ? -1 : DEFECT_CLASSES.indexOf(defectClass));

/** A sum of counts that stays null once one of them is unreadable. */
function addCounts(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/** An object in a module's data that holds one-off labels, and where it sits. */
type Holder = { size: string; hand: Hand | null; defectClass: DefectClass | null; node: JsonRecord };

/**
 * The key each ordered size's data is saved under, picked as the framework
 * picks it (lib/validation restrictToOrderedSizes): the canonical spelling,
 * else the first other spelling of the size. Sizes not in the order are
 * left out: they count nowhere (BUILD_SPEC 6.2 rule 4).
 */
function sizeKeys(sizes: JsonRecord, ordered: readonly string[]): Map<string, string> {
  const wanted = new Set(ordered);
  const keys = new Map<string, string>();
  for (const key of Object.keys(sizes)) {
    const size = key.length <= 40 ? normaliseSize(key) : null;
    if (size === null || !wanted.has(size)) continue;
    if (!keys.has(size) || key === size) keys.set(size, key);
  }
  return keys;
}

/**
 * Every object of a module's data that the inspection counts one-off labels
 * in (labelScope), in the order the capture screen goes through them:
 * ordered sizes in the template's order, the right hand before the left
 * with a hand split (the size itself without), then the visual classes
 * switched on, in report order.
 */
function holdersOf(modules: JsonRecord, moduleKey: LabelModule, scope: LabelScope): Holder[] {
  const layout = scope[moduleKey];
  const sizes = layout ? ownRecord(ownRecord(modules, moduleKey) ?? {}, "sizes") : null;
  if (!layout || !sizes) return [];
  const classes: readonly (DefectClass | null)[] = moduleKey === "visual" ? (scope.visual?.classes ?? []) : [null];
  const keys = sizeKeys(sizes, scope.sizes);
  const holders: Holder[] = [];
  for (const size of scope.sizes) {
    const key = keys.get(size);
    const entry = key === undefined ? null : ownRecord(sizes, key);
    if (!entry) continue;
    const parts: { hand: Hand | null; node: JsonRecord | null }[] = layout.handSplit
      ? HANDS.map((hand) => ({ hand, node: ownRecord(entry, hand) }))
      : [{ hand: null, node: entry }];
    for (const { hand, node } of parts) {
      if (!node) continue;
      for (const defectClass of classes) {
        const holder = defectClass === null ? node : ownRecord(node, defectClass);
        if (holder) holders.push({ size, hand, defectClass, node: holder });
      }
    }
  }
  return holders;
}

/** The labels one object records, each with its count there. One label entered twice adds up. */
function labelsIn(node: JsonRecord, moduleKey: LabelModule): { kind: LabelKind; label: string; count: number | null }[] {
  const unmapped = new Map<string, { kind: LabelKind; label: string; count: number | null }>();
  const list = Object.hasOwn(node, "unmapped") ? node.unmapped : undefined;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.label !== "string") continue;
      const label = oneLine(entry.label);
      if (!label || label.length > LIMITS.label) continue;
      const held = unmapped.get(labelKey(label));
      const count = readCount(entry.count);
      unmapped.set(labelKey(label), held ? { ...held, count: addCounts(held.count, count) } : { kind: "unmapped", label, count });
    }
  }
  const found = [...unmapped.values()];

  if (moduleKey === "watertight" && Object.hasOwn(node, "otherDescription") && typeof node.otherDescription === "string") {
    const label = oneLine(node.otherDescription);
    if (label && label.length <= LIMITS.label) {
      const holes = Object.hasOwn(node, "holes") ? node.holes : undefined;
      const count =
        holes === undefined || holes === null
          ? 0
          : isRecord(holes)
            ? readCount(Object.hasOwn(holes, OTHER_HOLE_CODE) ? holes[OTHER_HOLE_CODE] : undefined)
            : null;
      found.push({ kind: "other", label, count });
    }
  }
  return found;
}

/**
 * Every one-off label an inspection counts (`scope`): the visual and
 * watertight `unmapped` lists, and watertight "Other :" locations. A label
 * found in several sizes or hands is one entry, with each place and its
 * count, as the capture screen shows it as one row, and keeps the spelling
 * the capture screen shows: the first, in size order, right hand first. The
 * same words in another visual class are another label: the class is its
 * severity. Calc skips what was counted 0, so a place with 0 is left out,
 * and a label found nowhere is nothing to map. Sorted in report order:
 * module, class, one-off labels before "Other :" rows, then where each was
 * first found.
 */
export function findOneOffLabels(data: unknown, scope: LabelScope): FoundLabel[] {
  const modules = isRecord(data) ? ownRecord(data, "modules") : null;
  if (!modules) return [];

  const groups = new Map<string, FoundLabel>();
  for (const moduleKey of LABEL_MODULES) {
    for (const { size, hand, defectClass, node } of holdersOf(modules, moduleKey, scope)) {
      for (const { kind, label, count } of labelsIn(node, moduleKey)) {
        const id = [moduleKey, kind, defectClass ?? "", labelKey(label)].join("|");
        let group = groups.get(id);
        if (!group) {
          group = { module: moduleKey, kind, defectClass, label, places: [], count: 0 };
          groups.set(id, group);
        }
        if (count === 0) continue;
        // Each size and hand holds a class once, so a place is never seen twice.
        group.places.push({ size, hand, count });
        group.count = addCounts(group.count, count);
      }
    }
  }
  const placeRank = (place: LabelPlace) => scope.sizes.indexOf(place.size);
  return [...groups.values()]
    .filter((label) => label.places.length > 0)
    .sort(
      (a, b) =>
        LABEL_MODULES.indexOf(a.module) - LABEL_MODULES.indexOf(b.module) ||
        classRank(a.defectClass) - classRank(b.defectClass) ||
        LABEL_KINDS.indexOf(a.kind) - LABEL_KINDS.indexOf(b.kind) ||
        placeRank(a.places[0]) - placeRank(b.places[0]) ||
        handRank(a.places[0].hand) - handRank(b.places[0].hand) ||
        a.label.localeCompare(b.label),
    );
}

/** "Visual · Major", "Watertight", "Watertight · Other" (the report's "Other :" row) */
export function whereLabel(label: Pick<FoundLabel, "module" | "kind" | "defectClass">): string {
  const parts: string[] = [MODULE_LABEL[label.module]];
  if (label.defectClass) parts.push(CLASS_LABEL[label.defectClass]);
  if (label.kind === "other") parts.push("Other");
  return parts.join(" · ");
}

/** "Size M", "Size 7.0, Right Hand", as the capture screen names the place; a template's own size labels win ("Size Medium"). */
export function placeLabel(place: Pick<LabelPlace, "size" | "hand">, sizes?: readonly SizeOption[]): string {
  return formatSizeHand(place.size, place.hand, { sizes });
}

/** "2 found", "1 hole", or that a count cannot be read. */
export function countLabel(module: LabelModule, count: number | null): string {
  if (count === null) return "count unreadable";
  if (module === "watertight") return `${count} ${count === 1 ? "hole" : "holes"}`;
  return `${count} found`;
}

/** Where a label was recorded and how many, on one line: "Size M: 2 found", "Size M: 1; Size L: 2 (3 found in all)". */
export function foundSummary(label: Pick<FoundLabel, "module" | "places" | "count">, sizes?: readonly SizeOption[]): string {
  if (label.places.length === 1) {
    const [place] = label.places;
    return `${placeLabel(place, sizes)}: ${countLabel(label.module, place.count)}`;
  }
  const each = label.places.map((place) => `${placeLabel(place, sizes)}: ${place.count ?? "unreadable"}`);
  const total = label.count === null ? "total unreadable" : `${countLabel(label.module, label.count)} in all`;
  return `${each.join("; ")} (${total})`;
}

/* ------------------------------------------------------------------ *
 * Recording a mapping on an inspection's data
 * ------------------------------------------------------------------ */

export type MappingProblem = "not_found" | "invalid_count" | "same_code" | "invalid_data";

/** What a mapping did, for the audit log and the message. */
export type MappingChange = {
  module: LabelModule;
  kind: LabelKind;
  defectClass: DefectClass | null;
  label: string;
  code: string;
  /** Moved to the code, every place together. */
  count: number;
  /** Each size (and hand) the label was mapped in, with the count moved there. */
  places: { size: string; hand: Hand | null; count: number }[];
};

export type MappingOutcome =
  | { ok: true; data: JsonRecord; change: MappingChange }
  | { ok: false; problem: MappingProblem };

/** The count map next to a label, created when it is missing; null when something else is saved there. */
function countMapOf(holder: JsonRecord, key: "holes" | "counts"): JsonRecord | null {
  if (!Object.hasOwn(holder, key) || holder[key] === null || holder[key] === undefined) {
    holder[key] = {};
  }
  const map = holder[key];
  return isRecord(map) ? map : null;
}

/** Adds `count` to `code` in a count map; false when the count saved there is not a whole number. */
function addToCode(map: JsonRecord, code: string, count: number): boolean {
  const current = readCount(Object.hasOwn(map, code) ? map[code] : undefined);
  if (current === null) return false;
  map[code] = current + count;
  return true;
}

/**
 * The words of a one-off hole counted as "Other :" from now on say where it
 * is, as the report's row needs: they become the row's description, or join
 * the one written there.
 */
function describeOther(holder: JsonRecord, label: string): void {
  const current = Object.hasOwn(holder, "otherDescription") ? holder.otherDescription : undefined;
  if (current === undefined || current === null || (typeof current === "string" && !current.trim())) {
    holder.otherDescription = label;
    return;
  }
  if (typeof current !== "string" || labelKey(current).includes(labelKey(label))) return;
  const joined = `${oneLine(current)}; ${label}`;
  if (joined.length <= OTHER_DESCRIPTION_MAX) holder.otherDescription = joined;
}

/** What mapping did in one object: the count moved, a problem, or null when the label is not there. */
type Moved = number | MappingProblem | null;

/** A one-off label's entries leave `unmapped`, and their count joins `code` in the count map beside them. */
function mapUnmappedIn(holder: JsonRecord, target: LabelTarget, code: string): Moved {
  const list = Object.hasOwn(holder, "unmapped") ? holder.unmapped : undefined;
  if (!Array.isArray(list)) return null;
  const key = labelKey(target.label);
  const matches = (entry: unknown) => isRecord(entry) && typeof entry.label === "string" && labelKey(entry.label) === key;
  const matching = list.filter(matches);
  if (matching.length === 0) return null;

  let total = 0;
  for (const entry of matching) {
    const count = readCount((entry as JsonRecord).count);
    if (count === null) return "invalid_count";
    total += count;
  }
  if (total > 0) {
    const map = countMapOf(holder, COUNT_MAP_KEY[target.module]);
    if (!map) return "invalid_data";
    if (!addToCode(map, code, total)) return "invalid_count";
    if (target.module === "watertight" && code === OTHER_HOLE_CODE) describeOther(holder, target.label);
  }
  holder.unmapped = list.filter((entry) => !matches(entry));
  return total;
}

/** An "Other :" location's holes move from hole_other to `code`, and its description goes. */
function mapOtherIn(holder: JsonRecord, target: LabelTarget, code: string): Moved {
  const description = Object.hasOwn(holder, "otherDescription") ? holder.otherDescription : undefined;
  if (typeof description !== "string" || labelKey(description) !== labelKey(target.label)) return null;

  const holes = Object.hasOwn(holder, "holes") ? holder.holes : undefined;
  if (holes !== undefined && holes !== null && !isRecord(holes)) return "invalid_data";
  const other = isRecord(holes) ? readCount(Object.hasOwn(holes, OTHER_HOLE_CODE) ? holes[OTHER_HOLE_CODE] : undefined) : 0;
  if (other === null) return "invalid_count";
  if (other > 0) {
    const map = countMapOf(holder, "holes");
    if (!map) return "invalid_data";
    if (!addToCode(map, code, other)) return "invalid_count";
    // As the capture screen saves a location with no holes: without a key.
    delete map[OTHER_HOLE_CODE];
  }
  holder.otherDescription = null;
  return other;
}

/**
 * Records that a one-off label is `code` (BUILD_SPEC 4.2 rule 4), in every
 * size and hand the inspection counts it in (`scope`): its entries leave the
 * `unmapped` list and their count joins `code` in the count map beside them
 * (`counts` in visual, `holes` in watertight), in the same size, hand and
 * class, so it counts with that code from then on. A one-off hole mapped to
 * hole_other becomes the "Other :" row's description. An "Other :" location
 * moves its holes from hole_other to `code`, and its description goes.
 * Totals do not change: one-off labels already count towards them. Data
 * the inspection does not count (a size not in the order, the other hand
 * layout, a class switched off) is left as it is.
 *
 * All or nothing, and pure: returns new data and never changes `data`.
 */
export function mapOneOffLabel(data: unknown, target: LabelTarget, code: string, scope: LabelScope): MappingOutcome {
  if (!isRecord(data)) return { ok: false, problem: "invalid_data" };
  if (target.kind === "other" && code === OTHER_HOLE_CODE) return { ok: false, problem: "same_code" };

  const copy = structuredClone(data);
  const modules = ownRecord(copy, "modules");
  const places: MappingChange["places"] = [];
  for (const { size, hand, defectClass, node } of modules ? holdersOf(modules, target.module, scope) : []) {
    if (defectClass !== target.defectClass) continue;
    const moved = target.kind === "unmapped" ? mapUnmappedIn(node, target, code) : mapOtherIn(node, target, code);
    if (typeof moved === "string") return { ok: false, problem: moved };
    // Entries counted 0 go too, but only a count moved is a place.
    if (moved !== null && moved > 0) places.push({ size, hand, count: moved });
  }
  // Nothing counted under the label: it is not listed either, so the page was out of date.
  if (places.length === 0) return { ok: false, problem: "not_found" };

  const { module, kind, defectClass, label } = target;
  const count = places.reduce((total, place) => total + place.count, 0);
  return { ok: true, data: copy, change: { module, kind, defectClass, label, code, count, places } };
}

/** A mapping that could not be recorded, in plain words. */
export function describeMappingProblem(problem: MappingProblem, refNo: string): string {
  switch (problem) {
    case "not_found":
      return `This label is no longer on ${refNo}: someone has mapped or changed it. Reload the page.`;
    case "invalid_count":
      return `A count on ${refNo} is not a whole number, so the label cannot be mapped. Fix it on the inspection first.`;
    case "same_code":
      return "These holes already count as Hole, other location. Choose another code.";
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

/** Distinct words of three letters or more, without a plural s: "Defective Beads" gives defective, bead. */
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
 * lists in the same place, then codes any template lists in the same part of
 * the report (`section`), then the closest name ("Stain" before "Small dirt
 * or stain" for "stain"). A code templates list only in other parts (a hole
 * location for a visual defect, a dispensing fault) is not suggested: it
 * would count where no list has it. It stays on the full list.
 */
export function suggestCodes(
  label: string,
  codes: readonly CodeChoice[],
  {
    preferred = [],
    wording = new Map(),
    sections = new Map(),
    section,
    limit = 5,
  }: {
    preferred?: readonly string[];
    wording?: ReadonlyMap<string, readonly string[]>;
    /** The parts of the report templates list each code in. */
    sections?: ReadonlyMap<string, ReadonlySet<LabelSection>>;
    /** Where the label was recorded. */
    section?: LabelSection;
    limit?: number;
  } = {},
): string[] {
  const wanted = wordsOf(label);
  if (wanted.size === 0) return [];
  const preferredSet = new Set(preferred);
  const scored = codes.flatMap((choice) => {
    const listedIn = sections.get(choice.code);
    if (section && listedIn && listedIn.size > 0 && !listedIn.has(section)) return [];
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
    const here = section !== undefined && listedIn !== undefined && listedIn.has(section);
    return [{ ...choice, score, preferred: preferredSet.has(choice.code), here, extra: own.size - matched }];
  });
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.preferred) - Number(a.preferred) ||
        Number(b.here) - Number(a.here) ||
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
  /** Unique on the page: inspection, where and the label. */
  id: string;
  /** Codes it probably means, best first. */
  suggestions: string[];
  /**
   * The codes the inspection's template lists where the label was recorded:
   * the class's defects, or the hole locations. A code outside them still
   * counts, and the inspection shows it as an extra row.
   */
  listed: string[];
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
  template: { id: string; code: string; version: number };
  /** The template's sizes, for their own labels ("Medium"). */
  sizes: SizeOption[];
  labels: OneOffLabel[];
};

/**
 * An open inspection as read for its one-off labels: the parts of its data
 * the defects pages read (the order, for the ordered sizes; visual and
 * watertight) and the modules an admin switched off for it.
 */
export type InspectionQueryRow = {
  id: string;
  ref_no: string;
  status: InspectionStatus;
  inspection_date: string;
  template_id: string;
  /** `inspections.module_overrides` (BUILD_SPEC 4.4). */
  module_overrides: unknown;
  inspector: { full_name: string | null; email: string | null } | null;
  order_lots: unknown;
  visual: unknown;
  watertight: unknown;
};

/** Statuses in the order the unmapped tab lists them: what can be mapped now first. */
const STATUS_ORDER: readonly InspectionStatus[] = ["submitted", "reopened", "draft", "approved"];

/** Open inspections (not approved), newest first, with the parts of their data the defects pages read. */
export async function loadOpenInspections(supabase: DatabaseClient): Promise<InspectionQueryRow[]> {
  return selectAll<InspectionQueryRow>("the inspections", (from, to) =>
    supabase
      .from("inspections")
      .select(
        "id, ref_no, status, inspection_date, template_id, module_overrides, inspector:profiles!inspections_inspector_id_fkey(full_name, email), order_lots:data->modules->order_lots, visual:data->modules->visual, watertight:data->modules->watertight",
      )
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
      .overrideTypes<InspectionQueryRow[], { merge: false }>(),
  );
}

/**
 * The inspections with one-off labels where they count (labelScope), the
 * ones that can be mapped first, then in the order given (newest first),
 * each label with the codes it probably means, the codes its template lists
 * in its place, and a code for adding it as a new one. An inspection whose
 * template version cannot be read is left out: what it counts cannot be
 * told, and its results cannot be worked out either.
 */
export function buildInspectionLabels(
  rows: readonly InspectionQueryRow[],
  {
    codes,
    templates,
    registry,
  }: { codes: readonly DefectCodeRow[]; templates: readonly TemplateRecord[]; registry: ModuleRegistry },
): InspectionLabels[] {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  // Each version parsed once, however many inspections use it.
  const parsed = new Map<string, ResolvedTemplate | null>();
  const readable = (record: TemplateRecord) => {
    if (!parsed.has(record.id)) parsed.set(record.id, readResolvedTemplate(record.resolved));
    return parsed.get(record.id) ?? null;
  };
  const active = codes.filter((code) => code.active);
  const taken = new Set(codes.map((code) => code.code));
  // Every label templates give each code, so "Oil Stain" suggests stain, and where they list it.
  const wording = new Map<string, string[]>();
  const sections = new Map<string, Set<LabelSection>>();
  for (const template of templates) {
    for (const label of template.labels?.labels ?? []) {
      wording.set(label.code, [...(wording.get(label.code) ?? []), label.label]);
      sections.set(label.code, (sections.get(label.code) ?? new Set()).add(label.section));
    }
  }

  const result: InspectionLabels[] = [];
  for (const row of rows) {
    const record = templateById.get(row.template_id);
    const template = record ? readable(record) : null;
    if (!record || !template) continue;
    const data = { modules: { order_lots: row.order_lots, visual: row.visual, watertight: row.watertight } };
    const found = findOneOffLabels(data, labelScope(template, { moduleOverrides: row.module_overrides, data }, registry));
    if (found.length === 0) continue;
    const labels = found.map((label): OneOffLabel => {
      const listed = (record.labels?.labels ?? [])
        .filter((entry) =>
          label.module === "visual"
            ? entry.section === "visual" && entry.defectClass === label.defectClass
            : entry.section === "watertight",
        )
        .map((entry) => entry.code);
      return {
        ...label,
        id: [row.id, label.module, label.kind, label.defectClass ?? "", labelKey(label.label)].join("|"),
        suggestions: suggestCodes(label.label, active, { preferred: listed, wording, sections, section: label.module }),
        listed: [...new Set(listed)],
        newCode: suggestNewCode(label.label, label.module, taken),
      };
    });
    result.push({
      id: row.id,
      refNo: row.ref_no,
      status: row.status,
      inspectionDate: row.inspection_date,
      inspector: row.inspector ? row.inspector.full_name?.trim() || row.inspector.email?.trim() || null : null,
      template: { id: record.id, code: record.code, version: record.version },
      sizes: template.sizes.map(({ value, label }) => ({ value, label })),
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

/**
 * The three reads run side by side; the labels are matched with the codes
 * and templates afterwards. `registry` is the module registry
 * (modules/registry.ts), which gives each inspection's ordered sizes.
 */
export async function loadDefectsData(supabase: DatabaseClient, registry: ModuleRegistry): Promise<DefectsData> {
  const [codes, templates, rows] = await Promise.all([
    loadDefectCodes(supabase),
    loadTemplates(supabase),
    loadOpenInspections(supabase),
  ]);
  return { codes, templates, inspections: buildInspectionLabels(rows, { codes, templates, registry }) };
}

/** The counts the tab row shows. */
export type DefectsCounts = { codes: number; attention: number; unmapped: number; shortforms: number };

/** `glossary`: the shortforms (loadGlossaryState in lib/ai/settings.ts, which the server reads after its admin check). */
export function defectsCounts(
  data: DefectsData,
  glossary: readonly unknown[],
  maps: readonly TemplateLabelMap[] = buildLabelMaps(data.templates, data.codes),
): DefectsCounts {
  return {
    codes: data.codes.length,
    attention: maps.reduce((total, map) => total + map.attention, 0),
    unmapped: countUnmapped(data.inspections),
    shortforms: glossary.length,
  };
}
