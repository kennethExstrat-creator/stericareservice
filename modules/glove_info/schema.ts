// Glove Information (BUILD_SPEC 6.1 glove_info): the glove's variants. A
// variant is one combination of surface texture, indicative weight, colour
// and length (Kenneth, 11 October 2026: one PO can hold several), for the
// sizes it covers. Every value may be missing while the inspection is a
// draft.
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";
import { DecimalCellSchema, TextCellSchema } from "@/modules/_framework";

/**
 * TextCellSchema's limit (lib/validation/cells.ts). Saved data that fails the
 * schema cannot be shown or edited (invalid_data), so the fields take no more
 * and setText keeps no more.
 */
export const TEXT_MAX_LENGTH = 2000;

/** More variants than any PO holds: a list that grows without end is a mistake. */
export const MAX_VARIANTS = 20;

export const GLOVE_INFO_TEXT_FIELDS = ["gloveType", "surfaceTexture", "colour"] as const;
export type GloveInfoTextField = (typeof GLOVE_INFO_TEXT_FIELDS)[number];

/**
 * Glove length in mm (Kenneth, 11 October 2026: show the unit). A length
 * saved before as printed text ("240 mm minimum") reads as its number.
 */
const LengthCellSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const number = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  return number ? Number(number[0]) : null;
}, DecimalCellSchema);

export const GloveVariantSchema = z.strictObject({
  /** The sizes this variant covers, canonical; none picked: every size of the order. */
  sizes: z.array(CanonicalSizeSchema).default(() => []),
  /** As on the onsite form: "Nitrile, powder free". */
  gloveType: TextCellSchema,
  /** "Finger-textured". */
  surfaceTexture: TextCellSchema,
  /** Grams. Weight compares each size it covers with it (rule 9). */
  indicativeWeight: DecimalCellSchema,
  colour: TextCellSchema,
  /** In mm, as on the order or the form (240). The dimensions module measures the gloves' length. */
  length: LengthCellSchema,
});
export type GloveVariant = z.infer<typeof GloveVariantSchema>;

const VARIANT_FIELDS = ["gloveType", "surfaceTexture", "indicativeWeight", "colour", "length"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Data saved before variants (one set of values, October 2026) reads as the
 * first variant, covering every size; a value written straight onto the
 * module (a custom field's mapsTo) fills the first variant where it is empty.
 */
function withVariants(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const loose = VARIANT_FIELDS.filter((field) => field in value);
  if (loose.length === 0) return value;
  const rest: Record<string, unknown> = { ...value };
  for (const field of loose) delete rest[field];
  const variants = Array.isArray(value.variants) ? [...value.variants] : [];
  const first: Record<string, unknown> = isRecord(variants[0]) ? { ...variants[0] } : { sizes: [] };
  for (const field of loose) if (first[field] === undefined || first[field] === null) first[field] = value[field];
  variants[0] = first;
  return { ...rest, variants };
}

export const GloveInfoDataSchema = z.preprocess(
  withVariants,
  z.strictObject({
    variants: z.array(GloveVariantSchema).max(MAX_VARIANTS).default(() => []),
  }),
);
export type GloveInfoData = z.infer<typeof GloveInfoDataSchema>;

/** A new inspection's: one blank variant, as the screen shows it. */
export function emptyGloveInfo(): GloveInfoData {
  return { variants: [emptyVariant()] };
}

export function emptyVariant(): GloveVariant {
  return GloveVariantSchema.parse({});
}
