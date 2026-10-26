// Defaults a template can override: the heading, the labels (STD_EG's
// wording) and the config (BUILD_SPEC 6.1: the inner unit). The labels that
// name the inner unit ("# Glove per Inner Box", "# Glove per Plastic Pack")
// are set per template with it.
import { z } from "zod";

export const PACKING_CONFIG_TITLE = "Packing Configuration";

export const PACKING_FIELDS = ["glovesPerInner", "innersPerCase", "glovesPerCase", "packingMode"] as const;
export type PackingField = (typeof PACKING_FIELDS)[number];

/** The three counts that make up a case, in report order. */
export const PACKING_COUNTS = ["glovesPerInner", "innersPerCase", "glovesPerCase"] as const;
export type PackingCount = (typeof PACKING_COUNTS)[number];

/** The two counts the gloves per case is worked out from (Kenneth, 27 October 2026). */
export const CASE_FACTORS = ["glovesPerInner", "innersPerCase"] as const;

/**
 * `glovesPerCaseCheck` names the computed product (calc's computed values,
 * which the export carries). The screen no longer shows it on its own since
 * 27 October 2026: # Gloves per Case shows it in its place.
 */
export const PACKING_CONFIG_LABELS: Readonly<Record<PackingField | "glovesPerCaseCheck", string>> = {
  glovesPerInner: "# Glove per Inner Box",
  innersPerCase: "# Inners per Case",
  glovesPerCase: "# Gloves per Case",
  packingMode: "Packing Mode",
  glovesPerCaseCheck: "Gloves per Case (Inner × per Case)",
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
