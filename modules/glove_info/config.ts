// Defaults a template can override: the heading, the field labels (the
// wording of both reports) and the config (BUILD_SPEC 6.1: fields on/off).
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";

export const GLOVE_INFO_TITLE = "Glove Information";

/**
 * The fields in screen order: the onsite forms' Glove Type once per inspection
 * first (Kenneth, 12 October 2026), then each variant's. Glove Type is
 * recorded when known, never waited for: the reports do not print it
 * (BUILD_SPEC 6.2 rule 5 counts only the reports' fields).
 */
export const GLOVE_INFO_FIELDS = ["gloveType", "surfaceTexture", "indicativeWeight", "colour", "length"] as const;
export type GloveInfoField = (typeof GLOVE_INFO_FIELDS)[number];

/** A variant's fields in screen order: the step waits for each the template shows. */
export const VARIANT_FIELDS = ["surfaceTexture", "indicativeWeight", "colour", "length"] as const;
export type VariantField = (typeof VARIANT_FIELDS)[number];

export const GLOVE_INFO_LABELS: Readonly<Record<GloveInfoField, string>> = {
  gloveType: "Glove Type",
  surfaceTexture: "Glove Surface Texture",
  indicativeWeight: "Indicative Weight (Size M)",
  colour: "Glove Colour",
  length: "Glove Length",
};

export const GloveInfoConfigSchema = z.strictObject({
  fields: z
    .strictObject({
      // Off where a template has no switch: those saved before 11 October 2026 keep Glove Type as the custom module glove_type.
      gloveType: z.boolean().default(false),
      surfaceTexture: z.boolean(),
      indicativeWeight: z.boolean(),
      colour: z.boolean(),
      length: z.boolean(),
    })
    .describe("Fields shown on this template"),
  indicativeWeightSize: CanonicalSizeSchema.describe(
    "The size the indicative weight is given for. Relabel indicativeWeight to match.",
  ),
});
export type GloveInfoConfig = z.infer<typeof GloveInfoConfigSchema>;

export const GLOVE_INFO_DEFAULT_CONFIG: GloveInfoConfig = {
  fields: { gloveType: true, surfaceTexture: true, indicativeWeight: true, colour: true, length: true },
  indicativeWeightSize: "M",
};
