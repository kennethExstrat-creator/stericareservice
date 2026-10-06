// Defaults a template can override: the heading, the labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: the inner unit). The labels that
// name the inner unit ("# glove per inner box", "# glove per plastic pack")
// are set per template with it.
import { z } from "zod";

export const PACKING_CONFIG_TITLE = "Packing configuration";

export const PACKING_FIELDS = ["glovesPerInner", "innersPerCase", "glovesPerCase", "packingMode"] as const;
export type PackingField = (typeof PACKING_FIELDS)[number];

/** The three counts that make up a case, in report order. */
export const PACKING_COUNTS = ["glovesPerInner", "innersPerCase", "glovesPerCase"] as const;
export type PackingCount = (typeof PACKING_COUNTS)[number];

export const PACKING_CONFIG_LABELS: Readonly<Record<PackingField | "glovesPerCaseCheck", string>> = {
  glovesPerInner: "# glove per inner box",
  innersPerCase: "# inners per case",
  glovesPerCase: "# gloves per case",
  packingMode: "Packing Mode",
  glovesPerCaseCheck: "Gloves per case (inner × per case)",
};

export const INNER_UNITS = ["inner_box", "plastic_pack", "dispenser_box", "pouch"] as const;
export type InnerUnit = (typeof INNER_UNITS)[number];

/** How the context names the inner unit for the modules that follow (PackingValues.innerUnit). */
export const INNER_UNIT_NAMES: Readonly<Record<InnerUnit, string>> = {
  inner_box: "inner box",
  plastic_pack: "plastic pack",
  dispenser_box: "dispenser box",
  pouch: "pouch",
};

export const PackingConfigConfigSchema = z.strictObject({
  innerUnit: z
    .enum(INNER_UNITS)
    .describe(
      "What one inner unit is: inner box, plastic pack, dispenser box or pouch. Relabel glovesPerInner and innersPerCase to match.",
    ),
  fields: z
    .strictObject({ packingMode: z.boolean() })
    .describe("The onsite forms' Packing Mode text on or off."),
});
export type PackingConfigConfig = z.infer<typeof PackingConfigConfigSchema>;

export const PACKING_CONFIG_DEFAULT_CONFIG: PackingConfigConfig = {
  innerUnit: "inner_box",
  fields: { packingMode: false },
};
