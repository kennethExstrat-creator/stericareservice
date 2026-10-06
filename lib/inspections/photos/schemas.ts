// Inputs of the photo and file actions (BUILD_SPEC 8.1), validated with zod
// on the server and, for photos still in the upload queue, on the device
// before a retag. Forms post plain strings; these turn them into a tag.
import { z } from "zod";
import { UUID_PATTERN } from "@/lib/offline/id";
import type { PhotoTarget } from "@/lib/photos/target";
import { targetForModule } from "./view";

/** Longest caption kept: a sentence or two for the report, not a notebook. */
export const CAPTION_MAX_LENGTH = 500;

/** Module keys and custom module keys share one shape (lib/schemas/template.ts). */
const MODULE_TAG_PATTERN = /^[a-z][a-z0-9_]*$/;

export type PhotoTagField = "moduleKey" | "size" | "hand" | "defect" | "box" | "caption";
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const blankToNull = (value: unknown) => (value === undefined || (typeof value === "string" && value.trim() === "") ? null : value);

export const PhotoIdSchema = z.string().regex(UUID_PATTERN, { error: "This photo could not be found." });
export const FileIdSchema = z.string().regex(UUID_PATTERN, { error: "This file could not be found." });

export const ModuleTagSchema = z
  .string()
  .trim()
  .max(64, { error: "Choose a module from the list." })
  .regex(MODULE_TAG_PATTERN, { error: "Choose a module from the list." });

export const CaptionSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(CAPTION_MAX_LENGTH, { error: `Keep the caption under ${CAPTION_MAX_LENGTH} characters.` })
    .nullable(),
);

/** The retag and caption form: the module, the parts of the target it records, and the caption. */
export const PhotoTagFormSchema = z.object({
  photoId: PhotoIdSchema,
  moduleKey: z.preprocess(blankToNull, ModuleTagSchema.nullable()),
  size: z.preprocess(blankToUndefined, z.string().trim().min(1).max(16, { error: "Choose a size from the list." }).optional()),
  hand: z.preprocess(blankToUndefined, z.enum(["R", "L"], { error: "Choose the right or the left hand." }).optional()),
  defect: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(120, { error: "Choose a defect from the list." }).optional(),
  ),
  box: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{1,7}$/, { error: "Enter the box number in digits." })
      .transform(Number)
      .pipe(z.number().int().min(1, { error: "Box numbers start at 1." }))
      .optional(),
  ),
  caption: CaptionSchema,
});

export interface PhotoTagInput {
  photoId: string;
  moduleKey: string | null;
  /** Only what the module records (targetForModule). */
  target: PhotoTarget;
  caption: string | null;
}

export type ParseResult<T, K extends string> = { ok: true; data: T } | { ok: false; fieldErrors: FieldErrors<K | "form"> };

/** Reads a FormData field as text; a file or a missing field is null. */
export function formText(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

function fieldErrorsOf<K extends string>(error: z.ZodError, fields: readonly K[]): FieldErrors<K | "form"> {
  const errors: FieldErrors<K | "form"> = {};
  for (const issue of error.issues) {
    const head = issue.path[0];
    const key = typeof head === "string" && (fields as readonly string[]).includes(head) ? (head as K) : "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

const TAG_FIELDS: readonly (PhotoTagField | "photoId")[] = ["photoId", "moduleKey", "size", "hand", "defect", "box", "caption"];

/** The retag and caption form as a tag. Parts of the target the module does not record are dropped. */
export function parsePhotoTagForm(formData: FormData): ParseResult<PhotoTagInput, PhotoTagField | "photoId"> {
  const parsed = PhotoTagFormSchema.safeParse(Object.fromEntries(TAG_FIELDS.map((name) => [name, formText(formData, name) ?? undefined])));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error, TAG_FIELDS) };
  const { photoId, moduleKey, size, hand, defect, box, caption } = parsed.data;
  const target: PhotoTarget = {};
  if (size !== undefined) target.size = size;
  if (hand !== undefined) target.hand = hand;
  if (defect !== undefined) target.defect = defect;
  if (box !== undefined) target.box = box;
  return { ok: true, data: { photoId, moduleKey, target: targetForModule(moduleKey, target), caption } };
}

export const PhotoIdFormSchema = z.object({ photoId: PhotoIdSchema });

export const PhotoReportFormSchema = z.object({
  photoId: PhotoIdSchema,
  include: z.enum(["true", "false"], { error: "Say whether the photo goes into the report." }).transform((value) => value === "true"),
});

export const FileIdFormSchema = z.object({ fileId: FileIdSchema });

/** One of the small id forms (delete, report choice) read from FormData. */
export function parseForm<S extends z.ZodObject>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.infer<S> } | { ok: false; message: string } {
  const fields = Object.keys(schema.shape);
  const parsed = schema.safeParse(Object.fromEntries(fields.map((name) => [name, formText(formData, name) ?? undefined])));
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, message: parsed.error.issues[0]?.message ?? "Something in the request was not valid." };
}
