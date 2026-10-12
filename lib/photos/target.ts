import { z } from "zod";
import { SizeSchema } from "@/lib/schemas/common";
import { isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import { PACKAGING_LEVELS } from "@/modules/_framework/contract";

/* ------------------------------------------------------------------ *
 * Photo tags (BUILD_SPEC 8.1): the module a photo was taken in, and the
 * size, hand, defect, box, packaging level or list entry in focus.
 * inspection_photos.module_key holds the module; inspection_photos.target
 * holds the rest as one string, "size:M/hand:R/defect:thin_spot/box:253".
 * ------------------------------------------------------------------ */

/**
 * In the order the target string lists them. Level and item came later and
 * go last, so a photo tagged before them keeps the same target string.
 */
export const TARGET_KEYS = ["size", "hand", "defect", "box", "level", "item"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];

export const HandSchema = z.enum(["R", "L"]);

/** Labelling's packaging levels: the inner unit (dispenser box, plastic pack) and the carton. */
export const PackagingLevelSchema = z.enum(PACKAGING_LEVELS);

/** The key of an entry of a module's own list: a document on the checklist, a loading stage. */
export const ITEM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const ItemKeySchema = z.string().regex(ITEM_KEY_PATTERN);

export const PhotoTargetSchema = z.strictObject({
  /** Normalised size, as in order_lots ("M", "7.0"). */
  size: SizeSchema.optional(),
  /** Right or left hand, in templates with handSplit. */
  hand: HandSchema.optional(),
  /** A defect code ("thin_spot"), or the label of a one-off defect not mapped yet. */
  defect: z.string().trim().min(1).max(120).optional(),
  /** The number in focus: a carton's in carton sampling, a box's in dispensing and labelling (not a carton number, 6.2 rule 7). */
  box: z.number().int().positive().optional(),
  /** The packaging level in labelling: the inner unit or the carton. */
  level: PackagingLevelSchema.optional(),
  /** An entry of the module's own list by its key: a document (documents), a loading stage (loading). */
  item: ItemKeySchema.optional(),
});
export type PhotoTarget = z.infer<typeof PhotoTargetSchema>;

export const PhotoTagSchema = z.object({
  /** A module key, or a custom module's key. Null: not tagged yet (a desktop upload). */
  moduleKey: z.string().min(1).nullable(),
  target: PhotoTargetSchema,
});
export type PhotoTag = z.infer<typeof PhotoTagSchema>;

/**
 * The target string: `key:value` pairs joined by "/", keys always in
 * TARGET_KEYS order, values percent-encoded so a label holding "/" or ":"
 * survives. Null for an empty target (the column is nullable). Throws on an
 * invalid target: tags come from code, not from typing.
 */
export function buildTarget(target: PhotoTarget): string | null {
  const parsed = PhotoTargetSchema.parse(target);
  const parts = TARGET_KEYS.flatMap((key) => {
    const value = parsed[key];
    return value === undefined ? [] : [`${key}:${encodeURIComponent(String(value))}`];
  });
  return parts.length > 0 ? parts.join("/") : null;
}

export type ParsedTarget = { ok: true; target: PhotoTarget } | { ok: false; error: string };

/** Reads a target string in any key order; blank or null is the empty target. */
export function parseTarget(text: string | null | undefined): ParsedTarget {
  if (text === null || text === undefined || text.trim() === "") return { ok: true, target: {} };
  const raw: Record<string, unknown> = {};
  for (const part of text.split("/")) {
    const colon = part.indexOf(":");
    if (colon <= 0) return { ok: false, error: `"${part}" is not key:value.` };
    const key = part.slice(0, colon);
    if (!isTargetKey(key)) return { ok: false, error: `Unknown target key "${key}".` };
    if (key in raw) return { ok: false, error: `"${key}" appears twice.` };
    let value: string;
    try {
      value = decodeURIComponent(part.slice(colon + 1));
    } catch {
      return { ok: false, error: `"${key}" has a malformed value.` };
    }
    raw[key] = key === "box" && /^\d+$/.test(value) ? Number(value) : value;
  }
  const parsed = PhotoTargetSchema.safeParse(raw);
  if (parsed.success) return { ok: true, target: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "target"}: ${issue.message}` };
}

function isTargetKey(key: string): key is TargetKey {
  return (TARGET_KEYS as readonly string[]).includes(key);
}

/* ------------------------------------------------------------------ *
 * Auto-tagging
 * ------------------------------------------------------------------ */

/** What the capture screen has in focus when a photo is taken (the framework's CaptureFocus, nulls allowed). */
export interface CaptureFocus {
  /** The module (or custom module) on screen. */
  moduleKey: string;
  size?: string | null;
  hand?: "R" | "L" | null;
  defect?: string | null;
  box?: number | null;
  level?: "inner" | "carton" | null;
  item?: string | null;
}

/**
 * The focus worth recording in each module: what an inspector can have
 * selected there. The size tab stays selected across modules, and a box
 * entered in dispensing should not follow the inspector into dimensions.
 */
export const MODULE_TARGET_KEYS: Readonly<Record<ModuleKey, readonly TargetKey[]>> = {
  header: [],
  glove_info: [],
  order_lots: ["size"],
  packing_config: [],
  sampling_plan: ["size"],
  carton_sampling: ["size", "box"],
  dimensions: ["size"],
  weight: ["size"],
  force_at_break: ["size"],
  tensile: ["size"],
  watertight: ["size", "hand", "defect"],
  visual: ["size", "hand", "defect"],
  dispensing_packing: ["size", "box"],
  dispensing_safedon: ["size", "box", "defect"],
  labeling: ["size", "box", "defect", "level"],
  conclusion: [],
  dye_leak: ["size"],
  documents: ["item"],
  loading: ["item"],
};

/** Custom modules can repeat per size (BUILD_SPEC 4.3, grid.repeatPer). */
const CUSTOM_MODULE_TARGET_KEYS: readonly TargetKey[] = ["size"];

/**
 * The tag for a photo taken now: the module on screen and the parts of the
 * focus relevant to it. A focus value that is not valid is left out rather
 * than blocking the photo.
 */
export function autoTag(focus: CaptureFocus): PhotoTag {
  const keys = isModuleKey(focus.moduleKey) ? MODULE_TARGET_KEYS[focus.moduleKey] : CUSTOM_MODULE_TARGET_KEYS;
  const target: Record<string, unknown> = {};
  for (const key of keys) {
    const value = PhotoTargetSchema.shape[key].safeParse(focus[key] ?? undefined);
    if (value.success && value.data !== undefined) target[key] = value.data;
  }
  return { moduleKey: focus.moduleKey, target: target as PhotoTarget };
}
