// Inspection data (BUILD_SPEC 4.1): `{ modules: { <key>: {...} }, custom: { <key>: {...} } }`,
// each entry validated by its module's schema. Every module also carries an
// inspector comment; the framework keeps it under the reserved key `comment`
// inside the entry and strips it before the module's schema sees the data.
// Beside them, `report`: the capture screen's Report page options, which no
// module reads (lib/schemas/report-options.ts; Kenneth, 27 October 2026).
import { z } from "zod";
import { JsonValueSchema, SizeSchema } from "@/lib/schemas/common";

export const InspectionDataSchema = z.looseObject({
  modules: z.record(z.string(), JsonValueSchema),
  custom: z.record(z.string(), JsonValueSchema),
});

export type InspectionData = {
  modules: Readonly<Record<string, unknown>>;
  custom: Readonly<Record<string, unknown>>;
  /**
   * The Report page's options as saved, absent until one is changed; read
   * with their defaults (readReportOptions, lib/inspections/capture/report.ts).
   */
  report?: unknown;
};

export type DataNamespace = "modules" | "custom";

export function emptyInspectionData(): InspectionData {
  return { modules: {}, custom: {} };
}

/** Reserved in every module and custom module entry. Do not use it in a data schema. */
export const COMMENT_KEY = "comment";

export type ModuleEntry = {
  /** The saved entry without the comment; undefined when nothing is saved. */
  value: unknown;
  comment: string | null;
  /** Anything besides the comment is saved. */
  hasData: boolean;
};

export function readModuleEntry(data: InspectionData, namespace: DataNamespace, key: string): ModuleEntry {
  const stored = data[namespace][key];
  if (stored === undefined || stored === null) return { value: undefined, comment: null, hasData: false };
  if (!isRecord(stored)) return { value: stored, comment: null, hasData: true };
  const { [COMMENT_KEY]: comment, ...value } = stored;
  return {
    value,
    comment: typeof comment === "string" && comment.trim() !== "" ? comment : null,
    hasData: Object.keys(value).length > 0,
  };
}

/**
 * A module's saved data parsed with its schema, its empty data when nothing
 * is saved. Every saved size is included: this is what Capture edits and
 * hands back whole to onChange. calc and the export see ordered sizes only.
 */
export function parseModuleData<TData>(
  definition: { readonly dataSchema: z.ZodType<TData>; emptyData(): TData },
  entry: ModuleEntry,
): z.ZodSafeParseResult<TData> {
  return definition.dataSchema.safeParse(entry.hasData ? entry.value : definition.emptyData());
}

/** New data with a module's entry replaced, whole; its comment is kept. */
export function writeModuleData(
  data: InspectionData,
  namespace: DataNamespace,
  key: string,
  next: Readonly<Record<string, unknown>>,
): InspectionData {
  const { comment } = readModuleEntry(data, namespace, key);
  const value: Record<string, unknown> = { ...next };
  delete value[COMMENT_KEY];
  const entry = comment === null ? value : { ...value, [COMMENT_KEY]: comment };
  return { ...data, [namespace]: { ...data[namespace], [key]: entry } };
}

/** New data with a module's comment set, or removed when blank; its values are kept. */
export function writeModuleComment(
  data: InspectionData,
  namespace: DataNamespace,
  key: string,
  comment: string | null,
): InspectionData {
  const { value } = readModuleEntry(data, namespace, key);
  const base = isRecord(value) ? value : {};
  const entry = comment === null || comment.trim() === "" ? base : { ...base, [COMMENT_KEY]: comment };
  return { ...data, [namespace]: { ...data[namespace], [key]: entry } };
}

/**
 * Data schema of a per-size module: `{ sizes: { M: entry, L: entry } }`. The
 * framework reads `sizes` to keep unordered sizes out (6.2 rule 4). Add
 * module-wide fields with `.extend({...})`.
 */
export function perSizeData<Entry extends z.ZodType>(entry: Entry) {
  return z.strictObject({ sizes: z.record(SizeSchema, entry).default({}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
