// The file channel (BUILD_SPEC 8.1 "Lab reports and certificates"): lab
// reports and certificates are inspection_files rows that the capture screen
// uploads; a module never touches storage. A module that needs a file keeps
// the row's id in its own data (`FileIdCellSchema`), set through the file
// slot (`ModuleFileSlot`, modules/_framework/file-slot.tsx), so "the lab
// report is attached" is a fact calc reads from the data, the same on the
// iPad, in the server actions and in the export. Every caller that decides a
// result also passes the inspection's files (InspectionMeta.files): then a
// kept id whose file has since been deleted is missing, and a file added
// outside the module (the gallery keeps no id) still counts for it.
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
  return `${name}: the ${file} attached here is not among this inspection's files. It may still be uploading from another device; if it was deleted, attach it again.`;
}
