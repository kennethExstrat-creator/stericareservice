// Defaults a template can override: the heading, the field labels (the
// wording of both reports) and the config (BUILD_SPEC 6.1: fields on/off).
import { z } from "zod";
import { CanonicalSizeSchema } from "@/lib/sizes";

export const GLOVE_INFO_TITLE = "Glove Information";

export const GLOVE_INFO_FIELDS = ["surfaceTexture", "indicativeWeight", "colour", "length"] as const;
export type GloveInfoField = (typeof GLOVE_INFO_FIELDS)[number];

export const GLOVE_INFO_LABELS: Readonly<Record<GloveInfoField, string>> = {
  surfaceTexture: "Glove surface texture",
  indicativeWeight: "Indicative weight (size M)",
  colour: "Glove colour",
  length: "Glove length",
};

export const GloveInfoConfigSchema = z.strictObject({
  fields: z
    .strictObject({
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
  fields: { surfaceTexture: true, indicativeWeight: true, colour: true, length: true },
  indicativeWeightSize: "M",
};
