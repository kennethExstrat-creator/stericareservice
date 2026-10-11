// Defaults a template can override: the heading, the field labels (the
// wording of both reports) and the config (BUILD_SPEC 6.1: fields on/off).
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";

export const GLOVE_INFO_TITLE = "Glove Information";

/** A variant's fields in screen order: the onsite forms' Glove Type first (it was a custom module of its own until 11 October 2026). */
export const GLOVE_INFO_FIELDS = ["gloveType", "surfaceTexture", "indicativeWeight", "colour", "length"] as const;
export type GloveInfoField = (typeof GLOVE_INFO_FIELDS)[number];

/**
 * Recorded when known, never waited for: the reports do not print Glove
 * Type, and it was an optional field of its own before (BUILD_SPEC 6.2 rule 5
 * counts only the reports' fields).
 */
export const OPTIONAL_GLOVE_INFO_FIELDS: ReadonlySet<GloveInfoField> = new Set(["gloveType"]);

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
      // On unless a template says otherwise: templates saved before it came here have no switch for it.
      gloveType: z.boolean().default(true),
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
