// Defaults a template can override: the heading, the labels (STD_EG's
// wording, docs/DATA_DICTIONARY.md) and the config (BUILD_SPEC 6.1: AQL,
// hole locations and their labels, handSplit).
import { z } from "zod";
import { AqlSchema } from "@/lib/aql";
import { DefectCodeSchema } from "./schema";

export const WATERTIGHT_TITLE = "Freedom from Holes by watertight test";

/**
 * Data field keys and captions. `{codeLetters}` and `{aql}` in the heading are
 * filled in by calc (computed.heading).
 */
export const WATERTIGHT_LABELS = {
  tested: "No. of sample tested",
  holes: "Pin hole",
  otherDescription: "Other : description",
  unmapped: "Defect not in the list",
  codeLetter: "Sampling code letter",
  accept: "Accept",
  reject: "Reject",
  totalDefects: "Total number of defects found",
  result: "Freedom from holes (Passed / Failed)",
  heading: "Freedom from Holes by watertight test (Single sampling code letter {codeLetters}, AQL {aql})",
  defectLimit: "Defect Limit",
} as const satisfies Readonly<Record<string, string>>;

/** The location whose row ends in a colon on both reports: otherDescription says where. */
export const OTHER_LOCATION = "hole_other";

export const HoleLocationSchema = z.strictObject({
  code: DefectCodeSchema.describe("Defect code (defect_codes). A code not in defect_codes is flagged for an admin."),
  label: z.string().min(1).max(200).describe("The location in this template's wording"),
});
export type HoleLocation = z.infer<typeof HoleLocationSchema>;

export const WatertightConfigSchema = z.strictObject({
  aql: AqlSchema.nullable().describe(
    "AQL of the watertight test. Empty: the client's AQL, else 1.5 (BUILD_SPEC 7). A value set here wins.",
  ),
  locations: z
    .array(HoleLocationSchema)
    .refine((locations) => new Set(locations.map((location) => location.code)).size === locations.length, {
      error: "Each hole location code may be listed once.",
    })
    .describe("Hole locations in the template's order and wording, each mapped to a defect code"),
  handSplit: z
    .boolean()
    .describe("Record right and left hands apart (surgical gloves). The gloves tested and the limits stay per size."),
});
export type WatertightConfig = z.infer<typeof WatertightConfigSchema>;

/**
 * STD_EG's locations, no hand split. The AQL is left to the context (the
 * client's, else BUILD_SPEC 7's 1.5): the framework ranks a template's AQL
 * above the client's, so a default here would hide every client's value.
 */
export const WATERTIGHT_DEFAULT_CONFIG: WatertightConfig = {
  aql: null,
  locations: [
    { code: "hole_crotch", label: "Between fingers (crotch)" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_finger", label: "Finger" },
    { code: "hole_cuff", label: "Cuff" },
    { code: OTHER_LOCATION, label: "Other :" },
  ],
  handSplit: false,
};
