// The file channel (BUILD_SPEC 8.1 "Lab reports and certificates"): lab
// reports and certificates are inspection_files rows that the capture screen
// uploads; a module never touches storage. A module that needs a file keeps
// the row's id in its own data (`FileIdCellSchema`), set through the file
// slot (`ModuleFileSlot`, modules/_framework/file-slot.tsx), so "the lab
// report is attached" is a fact calc reads from the data, the same on the
// iPad, in the server actions and in the export. When the caller also knows
// which files the inspection holds (InspectionMeta.files), `heldFileState`
// tells a kept id whose file has since been deleted.
import { z } from "zod";
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
 * - `missing`: the files are known and it is not among them (deleted since).
 */
export type HeldFileState = "none" | "attached" | "missing";

export function heldFileState(context: Pick<InspectionContext, "files">, fileId: string | null): HeldFileState {
  if (fileId === null) return "none";
  const files = context.files ?? null;
  if (files === null) return "attached";
  return files.some((file) => file.id === fileId) ? "attached" : "missing";
}
