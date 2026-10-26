// The file channel (BUILD_SPEC 8.1 "Lab reports and certificates"): lab
// reports and certificates are inspection_files rows that the capture screen
// uploads; a module never touches storage. A module that needs a file keeps
// the row's id in its own data (`FileIdCellSchema`), set through the file
// slot (`ModuleFileSlot`, modules/_framework/file-slot.tsx), so "the lab
// report is attached" is a fact calc reads from the data, the same on the
// iPad, in the server actions and in the export. Every caller that decides a
// result also passes the inspection's files (InspectionMeta.files): then a
// kept id whose file has since been deleted is missing, and a file added
// outside the module (the gallery keeps no id) still counts for it. A step
// with lab reports (tensile, force at break) keeps a list of them, each with
// the sizes it gives results for (`labReports`): a lab often issues one
// report per size (Kenneth, 26 October 2026: "there are 4 different source").
import { z } from "zod";
import { SizeSchema } from "@/lib/schemas/common";
import { orderSizes } from "@/lib/sizes";
import type { InspectionContext } from "./context";

/** inspection_files.kind (BUILD_SPEC 5). */
export const FILE_KINDS = ["lab_report", "certificate", "other"] as const;
export const FileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof FileKindSchema>;

/** A file the screen has taken for a module: queued for upload, its row id fixed. */
export type AttachedFile = {
  /** The future inspection_files.id: what the module keeps. */
  readonly id: string;
  readonly name: string;
  readonly kind: FileKind;
};

/** A file the inspection holds (InspectionMeta.files): an inspection_files row, uploaded or queued. */
export type InspectionFileRef = {
  readonly id: string;
  /** The module it was added in; null when it was added without one (the gallery). */
  readonly moduleKey: string | null;
  readonly kind: FileKind | null;
};

/** The id of the inspection_files row a module relies on, null until a file is attached. */
export const FileIdCellSchema = z.uuid().nullable().default(null);

/**
 * A kept file id against the inspection's files:
 * - `none`: no id is kept;
 * - `attached`: the file is among the inspection's files, or they are not known here;
 * - `missing`: the files are known and it is not among them (deleted since,
 *   or still uploading from another device).
 */
export type HeldFileState = "none" | "attached" | "missing";

export function heldFileState(context: Pick<InspectionContext, "files">, fileId: string | null): HeldFileState {
  if (fileId === null) return "none";
  const files = context.files ?? null;
  if (files === null) return "attached";
  return files.some((file) => file.id === fileId) ? "attached" : "missing";
}

/**
 * The file a module needs one of (tensile's lab report): its kept id as
 * `heldFileState` reads it, or, once the inspection's files are known, any
 * file of the module and kind. So a lab report added in the gallery, which
 * keeps no id, attaches the module too, and so does one still listed after
 * the kept one was deleted. Not for files kept per entry (a documents item):
 * a file of the module says nothing about which entry it is for.
 */
export function moduleFileState(
  context: Pick<InspectionContext, "files">,
  { moduleKey, kind, fileId }: { moduleKey: string; kind: FileKind; fileId: string | null },
): HeldFileState {
  const held = heldFileState(context, fileId);
  if (held === "attached") return held;
  const files = context.files ?? null;
  if (files?.some((file) => file.moduleKey === moduleKey && file.kind === kind)) return "attached";
  return held;
}

/**
 * The warning for a missing file (`HeldFileState`), with what to do: the
 * caller's files can lag behind another device's upload queue, so the file
 * may still be on its way. `name` is what it is attached for ("Lab Report",
 * a document), `file` the word for the file.
 */
export function missingFileMessage(name: string, file = "file"): string {
  return `${name}: the ${file} linked here is not among this inspection's files. It may still be uploading from another device; if it was deleted, upload it again on Source Documents.`;
}

/* ------------------------------------------------------------------ *
 * A step's lab reports
 * ------------------------------------------------------------------ */

/**
 * One lab report a step keeps: the id of its inspection_files row and the
 * sizes it gives results for, in size order; none when they are not known
 * (a report linked before 26 October 2026, or one that names no size).
 */
export const LabReportEntrySchema = z.strictObject({
  fileId: z.uuid(),
  sizes: z.array(SizeSchema).default([]),
});
export type LabReportEntry = z.infer<typeof LabReportEntrySchema>;

/** A step's lab reports (`labReports` in its data), each file once. */
export const LabReportsSchema = z.array(LabReportEntrySchema).default([]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A step's data as saved, with the one lab report a step kept before 26
 * October 2026 (`labReport`: its id, or null for none) read as a list of it,
 * with no sizes, after any report already listed. A `labReport` that is no
 * id stays, for the schema to reject and salvageData to take out.
 */
export function foldLabReport(value: unknown): unknown {
  if (!isRecord(value) || !("labReport" in value)) return value;
  const { labReport, ...rest } = value;
  if (labReport === null || labReport === undefined) return rest;
  if (!z.uuid().safeParse(labReport).success) return value;
  if (rest.labReports !== undefined && !Array.isArray(rest.labReports)) return value;
  const list: unknown[] = Array.isArray(rest.labReports) ? rest.labReports : [];
  const listed = list.some((entry) => isRecord(entry) && entry.fileId === labReport);
  return { ...rest, labReports: listed ? list : [...list, { fileId: labReport, sizes: [] }] };
}

/**
 * The data schema of a step that keeps lab reports: `schema`, whose
 * `labReports` is LabReportsSchema, reading data saved with one `labReport`
 * as a list of that report (foldLabReport), so nothing saved before fails
 * to parse. Its JSON Schema, which Steri-AI reads, is `schema`'s.
 */
export function readingLabReports<T extends z.ZodType>(schema: T) {
  return z.preprocess(foldLabReport, schema);
}

/** A kept lab report with its state against the inspection's files (heldFileState). */
export type HeldLabReport = LabReportEntry & { readonly state: HeldFileState };

/**
 * A step's lab reports against the inspection's files: each one as
 * heldFileState reads it, and the step's state, as moduleFileState reads a
 * step's one file: `attached` when one of them is among the files, or, once
 * the files are known, when any file of the module and kind is (a lab report
 * uploaded on the step before 12 October 2026 keeps no id); `missing` when
 * reports are kept and none of them is; `none` when none is kept.
 */
export function labReportsState(
  context: Pick<InspectionContext, "files">,
  moduleKey: string,
  reports: readonly LabReportEntry[],
): { state: HeldFileState; reports: HeldLabReport[] } {
  const held = reports.map((entry): HeldLabReport => ({ ...entry, state: heldFileState(context, entry.fileId) }));
  if (held.some((entry) => entry.state === "attached")) return { state: "attached", reports: held };
  const own = moduleFileState(context, { moduleKey, kind: "lab_report", fileId: null });
  return { state: own === "attached" ? own : held.length > 0 ? "missing" : "none", reports: held };
}

/**
 * Lab reports added to a step's list: a report not listed yet goes last
 * with its sizes, one listed gains the sizes it lacked, and no other report
 * is replaced. `changed` counts the reports added or given a size.
 */
export function addLabReports(
  held: readonly LabReportEntry[],
  added: readonly LabReportEntry[],
): { reports: LabReportEntry[]; changed: number } {
  const reports = [...held];
  let changed = 0;
  for (const entry of added) {
    const at = reports.findIndex((kept) => kept.fileId === entry.fileId);
    const kept = at === -1 ? null : reports[at];
    const sizes = orderSizes([...(kept?.sizes ?? []), ...entry.sizes]);
    if (kept && sizes.join() === kept.sizes.join()) continue;
    if (kept) reports[at] = { ...kept, sizes };
    else reports.push({ fileId: entry.fileId, sizes });
    changed += 1;
  }
  return { reports, changed };
}

/** The data without the lab report Unlink took away (the file stays); the same data when it holds no such report. */
export function withoutLabReportFile<T extends { readonly labReports: readonly LabReportEntry[] }>(data: T, fileId: string): T {
  if (!data.labReports.some((entry) => entry.fileId === fileId)) return data;
  return { ...data, labReports: data.labReports.filter((entry) => entry.fileId !== fileId) };
}

/**
 * A step's lab reports in the order of `sizes` (the template's), each by the
 * first of its sizes in that order; a size the list does not hold after
 * them, and a report that names no size last.
 */
export function sortLabReports<T extends LabReportEntry>(reports: readonly T[], sizes: readonly string[]): T[] {
  const rank = (entry: LabReportEntry) => {
    if (entry.sizes.length === 0) return sizes.length + 1;
    return Math.min(...entry.sizes.map((size) => (sizes.includes(size) ? sizes.indexOf(size) : sizes.length)));
  };
  return [...reports].sort((a, b) => rank(a) - rank(b));
}

/** "Size S", "Sizes S, M": the sizes a lab report gives results for, by their labels; null for none. */
export function labReportSizesText(sizes: readonly string[], label: (size: string) => string = (size) => size): string | null {
  if (sizes.length === 0) return null;
  return `${sizes.length === 1 ? "Size" : "Sizes"} ${sizes.map(label).join(", ")}`;
}
