// Defaults a template can override: the heading, the labels (STD_EG's
// wording, docs/DATA_DICTIONARY.md) and the config (BUILD_SPEC 6.1: classes
// on or off with their AQL and defect list, handSplit).
import { z } from "zod";
import { AqlSchema } from "@/lib/aql";
import { DefectCodeSchema, type DefectClass } from "./schema";

export const VISUAL_TITLE = "Visual Inspection";

/**
 * Data field keys, class wording keyed class first (`majorTotal`), and
 * captions. `{codeLetters}` and `{aql}` are filled in by calc (computed).
 */
export const VISUAL_LABELS = {
  inspected: "No. of Sample Inspected",
  counts: "Defects",
  criticalCounts: "Critical Defects",
  majorCounts: "Major Defects",
  minorCounts: "Minor Defects",
  unmapped: "Defect Not in the List",
  codeLetter: "Sampling Code Letter",
  accept: "Accept",
  // The critical limit row's words, read before the shared ones: STD_EG prints "Acc. = 0 / Rej. = 1".
  criticalAccept: "Acc. =",
  reject: "Reject",
  criticalReject: "Rej. =",
  total: "Total Number of Defects Found",
  criticalTotal: 'Total Number of "Critical Defects" Found',
  majorTotal: 'Total Number of "Major Defects" Found',
  minorTotal: 'Total Number of "Minor Defects" Found',
  result: "Disposition (Passed / Failed)",
  criticalResult: "Disposition - Visual Critical (Passed / Failed)",
  majorResult: "Disposition - Visual Major (Passed / Failed)",
  minorResult: "Disposition - Visual Minor (Passed / Failed)",
  heading: "Visual Inspection (Single Sampling Code Letter {codeLetters})",
  criticalHeading: "Critical Defects (AQL {aql})",
  majorHeading: "Major Defects (AQL {aql})",
  minorHeading: "Minor Defects (AQL {aql})",
  criticalLimit: "Defect Limit : Accept / Reject",
  defectLimit: "Defect Limit",
} as const satisfies Readonly<Record<string, string>>;

export const VisualDefectSchema = z.strictObject({
  code: DefectCodeSchema.describe("Defect code (defect_codes). A code not in defect_codes is flagged for an admin."),
  label: z.string().min(1).max(200).describe("The defect in this template's wording"),
});
export type VisualDefect = z.infer<typeof VisualDefectSchema>;

const DefectListSchema = z
  .array(VisualDefectSchema)
  .refine((defects) => new Set(defects.map((defect) => defect.code)).size === defects.length, {
    error: "Each defect code may be listed once per class.",
  })
  .describe("Defects of this class in the template's order and wording, each mapped to a defect code");

const ClassSchema = z.strictObject({
  include: z.boolean().describe("This class is inspected on this template"),
  aql: AqlSchema.nullable().describe("AQL of this class. Empty: the client's AQL, else BUILD_SPEC 7's. A value set here wins."),
  defects: DefectListSchema,
});

const CriticalClassSchema = ClassSchema.extend({
  aql: z.literal(0).describe("Critical defects are always AQL 0: Accept 0 / Reject 1 (BUILD_SPEC 7)"),
});

export const VisualConfigSchema = z.strictObject({
  handSplit: z
    .boolean()
    .describe("Record right and left hands apart (surgical gloves). The gloves inspected and the limits stay per size."),
  classes: z
    .strictObject({ critical: CriticalClassSchema, major: ClassSchema, minor: ClassSchema })
    .describe("Defect classes: on or off, their AQL and their defect list. Severity is the class a code is listed under."),
});
export type VisualConfig = z.infer<typeof VisualConfigSchema>;
export type VisualClassConfig = VisualConfig["classes"][DefectClass];

/**
 * Every class on with STD_EG's lists, no hand split. Major and minor leave
 * the AQL to the context (the client's, else 2.5 and 4.0): the framework ranks
 * a template's AQL above the client's, so a default here would hide every
 * client's value. Critical is AQL 0 everywhere.
 */
export const VISUAL_DEFAULT_CONFIG: VisualConfig = {
  handSplit: false,
  classes: {
    critical: {
      include: true,
      aql: 0,
      defects: [
        { code: "embedded_insect", label: "Embedded Insects" },
        { code: "embedded_metal", label: "Embedded Metal Debris" },
      ],
    },
    major: {
      include: true,
      aql: null,
      defects: [
        { code: "thin_crotch_area", label: "Thin Area Between Fingers (Crotch)" },
        { code: "thin_crotch_ring", label: "Ring-Shaped Thin Area (Crotch)" },
        { code: "thin_body_area", label: "Thin Area on Glove Body" },
        { code: "thin_spot", label: "Thin Spot on Glove Body" },
        { code: "dirt_nonremovable", label: "Non-Removable Dirt" },
        { code: "stain", label: "Oil Stain" },
        { code: "foreign_matter", label: "Residue Material / Foreign Matter" },
        { code: "bead_defective", label: "Defective Bead" },
        { code: "lump_big", label: "Big Lumps (>2mm)" },
        // Only the onsite forms have these two (SKV, FM): codes of their own since 12 October 2026.
        { code: "skin_visual", label: "Skin Visual" },
        { code: "flow_mark", label: "Flow Mark" },
      ],
    },
    minor: {
      include: true,
      aql: null,
      defects: [
        { code: "dirt_small", label: "Small Dirt / Stain" },
        { code: "sticky_pleats", label: "Sticky Pleats (< 5mm)" },
        { code: "lump_small", label: "Lumps (<2mm)" },
        { code: "bead_poor", label: "Poor Beading" },
        { code: "bead_rolled", label: "Rolled Bead" },
        { code: "bead_defective", label: "Defective Beads" },
      ],
    },
  },
};
