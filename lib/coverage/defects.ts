// Defect labels per template, in report order, mapped to the canonical codes
// of supabase/seed.sql (BUILD_SPEC 4.2 rule 4, 11). Severity is the class a
// template puts a code in: "Defective bead" is major in STD_EG while
// "Defective beads" is minor, both bead_defective.
import type { DefectClass } from "./keys";
import type { TemplateCode } from "./types";

export type DefectLabel = {
  /** defect_codes.code */
  readonly code: string;
  /** The template's label: verbatim, with [sic] typos fixed. */
  readonly label: string;
  /** As printed, where it differs from `label` ([sic]). */
  readonly printed?: string;
};

/* ------------------------------------------------------------------ *
 * Visual inspection
 * ------------------------------------------------------------------ */

const CRITICAL: readonly DefectLabel[] = [
  { code: "embedded_insect", label: "Embedded Insects", printed: "Embeded Insects" },
  { code: "embedded_metal", label: "Embedded metal debris", printed: "Embeded metal debris" },
];

const STD_EG_VISUAL: Readonly<Record<DefectClass, readonly DefectLabel[]>> = {
  critical: CRITICAL,
  major: [
    { code: "thin_crotch_area", label: "Thin area between fingers (crotch)" },
    { code: "thin_crotch_ring", label: "Ring-shaped thin area (crotch)" },
    { code: "thin_body_area", label: "Thin area on glove body" },
    { code: "thin_spot", label: "Thin spot on glove body" },
    { code: "dirt_nonremovable", label: "Non-removable dirt" },
    { code: "stain", label: "Oil stain" },
    { code: "foreign_matter", label: "Residue material / foreign matter" },
    { code: "bead_defective", label: "Defective bead" },
    { code: "lump_big", label: "Big Lumps (>2mm)" },
  ],
  minor: [
    { code: "dirt_small", label: "Small dirt / stain" },
    { code: "sticky_pleats", label: "Sticky pleats (< 5mm)" },
    { code: "lump_small", label: "Lumps (<2mm)" },
    { code: "bead_poor", label: "Poor beading" },
    { code: "bead_rolled", label: "Rolled bead" },
    { code: "bead_defective", label: "Defective beads" },
  ],
};

const SAFEDON_EG_VISUAL: Readonly<Record<DefectClass, readonly DefectLabel[]>> = {
  critical: CRITICAL,
  major: [
    { code: "thin_crotch_ring", label: "Thin ring between fingers (crotch)" },
    { code: "thin_crotch_area", label: "Thin area between fingers (crotch)" },
    { code: "thin_body_area", label: "Thin patch / area (body)", printed: "Thin batch / area (body)" },
    { code: "thin_spot", label: "Thin spot" },
    { code: "dirt_nonremovable", label: "Non-removable dirt" },
    { code: "stain", label: "Stain" },
    { code: "powder_mark", label: "Powder mark" },
    { code: "bead_blister", label: "Bead blister" },
  ],
  minor: [
    { code: "dirt_small", label: "Small dirt / stain" },
    { code: "sticky_pleats", label: "Sticky pleats (< 5mm)" },
    { code: "lump_small", label: "Lumps (<2mm)" },
    { code: "bead_thin", label: "Thin bead" },
    { code: "bead_small_defect", label: "Thin bead / small beading defect" },
  ],
};

/**
 * Per template and class, in report order. STD_SG has no list: the SG onsite
 * form has blank rows for handwritten defects and no critical class. Its
 * lists are STD_EG's until confirmed (templates.ts lists it to confirm).
 */
export const VISUAL_DEFECTS: Readonly<Record<TemplateCode, Readonly<Record<DefectClass, readonly DefectLabel[]>>>> = {
  STD_EG: STD_EG_VISUAL,
  SAFEDON_EG: SAFEDON_EG_VISUAL,
  STD_SG: STD_EG_VISUAL,
};

/* ------------------------------------------------------------------ *
 * Watertight test: hole locations
 * ------------------------------------------------------------------ */

/** "Other :" ends in a colon on both reports: watertight.otherDescription holds the location. */
export const WATERTIGHT_LOCATIONS: Readonly<Record<TemplateCode, readonly DefectLabel[]>> = {
  STD_EG: [
    { code: "hole_crotch", label: "Between fingers (crotch)" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_finger", label: "Finger" },
    { code: "hole_cuff", label: "Cuff" },
    { code: "hole_other", label: "Other :" },
  ],
  SAFEDON_EG: [
    { code: "hole_crotch", label: "Between fingers" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_cuff", label: "Cuff" },
    { code: "hole_finger", label: "Finger" },
    { code: "glove_burst", label: "Glove burst" },
    { code: "hole_other", label: "Other :" },
  ],
  // The SG onsite form has 7 blank rows: STD_EG's locations until confirmed.
  STD_SG: [
    { code: "hole_crotch", label: "Between fingers (crotch)" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_finger", label: "Finger" },
    { code: "hole_cuff", label: "Cuff" },
    { code: "hole_other", label: "Other :" },
  ],
};

/* ------------------------------------------------------------------ *
 * Safedon dispensing check (SAFEDON_EG report page 3, Safedon onsite sheet)
 * ------------------------------------------------------------------ */

export type DispensingDefect = DefectLabel & {
  /** The definition shown in the app (onsite/SAFEDON_EG.md, "Definition to show in the app"). */
  readonly hint: string;
  /** The definition as printed. */
  readonly printedHint: string;
  /** The printed definition with its typos fixed, where it has any. */
  readonly correctedHint?: string;
};

export const SAFEDON_DISPENSING_DEFECTS: readonly DispensingDefect[] = [
  {
    code: "no_cuff",
    label: "No cuff",
    hint: "Cuff should ideally be at least 2 cm out",
    printedHint: "Cuff should ideallly be at least 2 cm out",
    correctedHint: "Cuff should ideally be at least 2 cm out",
  },
  {
    code: "finger_out",
    label: "Finger out",
    hint: "Only the cuff, not a finger, should come out first",
    printedHint: "Only cuff but no finger should be out first",
  },
  {
    code: "multiple_out",
    label: "Multiple gloves out",
    hint: "Only one glove should come out at a time",
    printedHint: "Only one glove should be out at one time",
  },
  {
    code: "stuck",
    label: "Glove stuck",
    hint: "Glove could not be dispensed or was very difficult to dispense",
    printedHint: "Glove ould not be dispensed or very difficult to dispense",
    correctedHint: "Glove could not be dispensed or very difficult to dispense",
  },
  {
    code: "sticky",
    label: "Sticky glove",
    hint: "Two or more gloves out at once because they stick together",
    printedHint: "Two or more gloves out at the same time caused by gloves sticking together",
  },
  {
    code: "faulty_cuff",
    label: "Faulty cuff",
    hint: "Deformed or misshapen cuff causing a dispensing problem",
    printedHint: "Deformed or out of shaped cuff which causes dispensing problem",
  },
];

/** Every defect code a template uses, for the seed check. */
export function defectCodesUsed(): ReadonlySet<string> {
  const codes = new Set<string>();
  for (const classes of Object.values(VISUAL_DEFECTS)) {
    for (const list of Object.values(classes)) for (const { code } of list) codes.add(code);
  }
  for (const list of Object.values(WATERTIGHT_LOCATIONS)) for (const { code } of list) codes.add(code);
  for (const { code } of SAFEDON_DISPENSING_DEFECTS) codes.add(code);
  return codes;
}
