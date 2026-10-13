// Defect labels per template, in report order, mapped to the canonical codes
// of supabase/seed.sql (BUILD_SPEC 4.2 rule 4, 11). Severity is the class a
// template puts a code in: "Defective Bead" is major in STD_EG while
// "Defective Beads" is minor, both bead_defective. Also the other coded
// lists a template fixes: stickiness codes and labelling checks.
import type { DefectClass, LabellingCheck, LabellingLevel } from "./keys";
import type { TemplateCode } from "./types";

export type DefectLabel = {
  /** defect_codes.code */
  readonly code: string;
  /** The template's label: the report's words, [sic] typos fixed, in Title Case (docs/DESIGN.md). */
  readonly label: string;
  /** As printed, where its words differ from `label` ([sic]). sources.ts keeps every label as printed. */
  readonly printed?: string;
  /** Not printed on the report: the shortform inspectors write for it on the onsite forms (ONSITE_MAJOR). */
  readonly written?: string;
};

/** A coded list entry as a module config holds it: a code and the template's label. */
export type ListItem = { readonly code: string; readonly label: string };

/** A list as a config holds it: code and label only. */
export function listItems(list: readonly DefectLabel[]): readonly ListItem[] {
  return list.map(({ code, label }) => ({ code, label }));
}

/* ------------------------------------------------------------------ *
 * Visual inspection
 * ------------------------------------------------------------------ */

const CRITICAL: readonly DefectLabel[] = [
  { code: "embedded_insect", label: "Embedded Insects", printed: "Embeded Insects" },
  { code: "embedded_metal", label: "Embedded Metal Debris", printed: "Embeded metal debris" },
];

/**
 * Major defects neither report prints: inspectors write them in the onsite
 * forms' blank Major rows, and they have codes of their own (Kenneth, 12
 * October 2026: "yes", for STD_EG and SAFEDON_EG). After the report's rows,
 * in the forms' order.
 */
const ONSITE_MAJOR: readonly DefectLabel[] = [
  { code: "skin_visual", label: "Skin Visual", written: "SKV" },
  { code: "flow_mark", label: "Flow Mark", written: "FM" },
];

/** The STD_EG report's lists, in report order: what STD_SG takes until its own are confirmed. */
const STD_EG_REPORT_VISUAL: Readonly<Record<DefectClass, readonly DefectLabel[]>> = {
  critical: CRITICAL,
  major: [
    { code: "thin_crotch_area", label: "Thin Area Between Fingers (Crotch)" },
    { code: "thin_crotch_ring", label: "Ring-Shaped Thin Area (Crotch)" },
    { code: "thin_body_area", label: "Thin Area on Glove Body" },
    { code: "thin_spot", label: "Thin Spot on Glove Body" },
    { code: "dirt_nonremovable", label: "Non-Removable Dirt" },
    { code: "stain", label: "Oil Stain" },
    { code: "foreign_matter", label: "Residue Material / Foreign Matter" },
    { code: "bead_defective", label: "Defective Bead" },
    { code: "lump_big", label: "Big Lumps (>2mm)" },
  ],
  minor: [
    { code: "dirt_small", label: "Small Dirt / Stain" },
    { code: "sticky_pleats", label: "Sticky Pleats (< 5mm)" },
    { code: "lump_small", label: "Lumps (<2mm)" },
    { code: "bead_poor", label: "Poor Beading" },
    { code: "bead_rolled", label: "Rolled Bead" },
    { code: "bead_defective", label: "Defective Beads" },
  ],
};

const STD_EG_VISUAL: Readonly<Record<DefectClass, readonly DefectLabel[]>> = {
  ...STD_EG_REPORT_VISUAL,
  major: [...STD_EG_REPORT_VISUAL.major, ...ONSITE_MAJOR],
};

const SAFEDON_EG_VISUAL: Readonly<Record<DefectClass, readonly DefectLabel[]>> = {
  critical: CRITICAL,
  major: [
    { code: "thin_crotch_ring", label: "Thin Ring Between Fingers (Crotch)" },
    { code: "thin_crotch_area", label: "Thin Area Between Fingers (Crotch)" },
    { code: "thin_body_area", label: "Thin Patch / Area (Body)", printed: "Thin batch / area (body)" },
    { code: "thin_spot", label: "Thin Spot" },
    { code: "dirt_nonremovable", label: "Non-Removable Dirt" },
    { code: "stain", label: "Stain" },
    { code: "powder_mark", label: "Powder Mark" },
    { code: "bead_blister", label: "Bead Blister" },
    ...ONSITE_MAJOR,
  ],
  minor: [
    { code: "dirt_small", label: "Small Dirt / Stain" },
    { code: "sticky_pleats", label: "Sticky Pleats (< 5mm)" },
    { code: "lump_small", label: "Lumps (<2mm)" },
    { code: "bead_thin", label: "Thin Bead" },
    { code: "bead_small_defect", label: "Thin Bead / Small Beading Defect" },
  ],
};

/**
 * Per template and class, in report order; STD_EG and SAFEDON_EG then add
 * ONSITE_MAJOR. STD_SG has no list: the SG onsite form has blank rows for
 * handwritten defects and no critical class. Its lists are the STD_EG
 * report's until confirmed (templates.ts lists it to confirm), without
 * ONSITE_MAJOR: Kenneth's "yes" of 12 October 2026 covered STD_EG and
 * SAFEDON_EG only, so STD_SG keeps the definition of its live version 2.
 */
export const VISUAL_DEFECTS: Readonly<Record<TemplateCode, Readonly<Record<DefectClass, readonly DefectLabel[]>>>> = {
  STD_EG: STD_EG_VISUAL,
  SAFEDON_EG: SAFEDON_EG_VISUAL,
  STD_SG: STD_EG_REPORT_VISUAL,
};

/* ------------------------------------------------------------------ *
 * Watertight test: hole locations
 * ------------------------------------------------------------------ */

/** "Other :" ends in a colon on both reports: watertight.otherDescription holds the location. */
export const WATERTIGHT_LOCATIONS: Readonly<Record<TemplateCode, readonly DefectLabel[]>> = {
  STD_EG: [
    { code: "hole_crotch", label: "Between Fingers (Crotch)" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_finger", label: "Finger" },
    { code: "hole_cuff", label: "Cuff" },
    { code: "hole_other", label: "Other :" },
  ],
  SAFEDON_EG: [
    { code: "hole_crotch", label: "Between Fingers" },
    { code: "hole_palm", label: "Palm" },
    { code: "hole_cuff", label: "Cuff" },
    { code: "hole_finger", label: "Finger" },
    { code: "glove_burst", label: "Glove Burst" },
    { code: "hole_other", label: "Other :" },
  ],
  // The SG onsite form has 7 blank rows: STD_EG's locations until confirmed.
  STD_SG: [
    { code: "hole_crotch", label: "Between Fingers (Crotch)" },
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
    label: "No Cuff",
    hint: "Cuff should ideally be at least 2 cm out",
    printedHint: "Cuff should ideallly be at least 2 cm out",
    correctedHint: "Cuff should ideally be at least 2 cm out",
  },
  {
    code: "finger_out",
    label: "Finger Out",
    hint: "Only the cuff, not a finger, should come out first",
    printedHint: "Only cuff but no finger should be out first",
  },
  {
    code: "multiple_out",
    label: "Multiple Gloves Out",
    hint: "Only one glove should come out at a time",
    printedHint: "Only one glove should be out at one time",
  },
  {
    code: "stuck",
    label: "Glove Stuck",
    hint: "Glove could not be dispensed or was very difficult to dispense",
    printedHint: "Glove ould not be dispensed or very difficult to dispense",
    correctedHint: "Glove could not be dispensed or very difficult to dispense",
  },
  {
    code: "sticky",
    label: "Sticky Glove",
    hint: "Two or more gloves out at once because they stick together",
    printedHint: "Two or more gloves out at the same time caused by gloves sticking together",
  },
  {
    code: "faulty_cuff",
    label: "Faulty Cuff",
    hint: "Deformed or misshapen cuff causing a dispensing problem",
    printedHint: "Deformed or out of shaped cuff which causes dispensing problem",
  },
];

/** A Safedon dispensing defect as the config holds it: code, label and the hint shown in the app. */
export type SafedonDefectConfig = ListItem & { readonly hint: string };

export function safedonDefectItems(): readonly SafedonDefectConfig[] {
  return SAFEDON_DISPENSING_DEFECTS.map(({ code, label, hint }) => ({ code, label, hint }));
}

/* ------------------------------------------------------------------ *
 * Stickiness codes (STD_EG report page 4)
 * ------------------------------------------------------------------ */

export type StickinessCode = ListItem & { readonly pass: boolean };

/** Stickiness codes of the STD_EG report legend, least to most sticky. */
export const STICKINESS_CODES: readonly (StickinessCode & { readonly printed?: string })[] = [
  { code: "A", label: "Non sticky", pass: true },
  { code: "B", label: "A mix of non sticky to lightly sticky", pass: true },
  {
    code: "B1",
    label: "A mix of non sticky to light stickiness at the bead",
    printed: "A mix of non sticky to light sickiness at the bead",
    pass: true,
  },
  { code: "C", label: "Lightly sticky but dispensable", pass: true },
  { code: "D", label: "Too sticky & affect dispensing", pass: false },
];

/** The codes as a config holds them: code, label and pass. */
export function stickinessCodes(): readonly StickinessCode[] {
  return STICKINESS_CODES.map(({ code, label, pass }) => ({ code, label, pass }));
}

/* ------------------------------------------------------------------ *
 * Labelling checks per level (BUILD_SPEC 11), in report order
 * ------------------------------------------------------------------ */

export type LabellingCheckLabel = ListItem & { readonly code: LabellingCheck };

/** The checks each report prints per level. STD_SG has no labelling module. */
export const LABELLING_CHECK_LISTS: Readonly<
  Record<"STD_EG" | "SAFEDON_EG", Readonly<Record<LabellingLevel, readonly LabellingCheckLabel[]>>>
> = {
  STD_EG: {
    inner: [
      { code: "lot_no", label: "Wrong / No Lot Number" },
      { code: "mfg_date", label: "Wrong / No Mfg. Date" },
      { code: "artwork", label: "Wrong Artwork Print" },
    ],
    carton: [
      { code: "lot_no", label: "Wrong / No Lot Number" },
      { code: "mfg_date", label: "Wrong / No Mfg. Date" },
      { code: "artwork", label: "Wrong Artwork Print" },
      { code: "carton_no", label: "No Box/Carton # Printed" },
    ],
  },
  SAFEDON_EG: {
    inner: [
      { code: "lot_no", label: "Wrong / No Lot Number" },
      { code: "mfg_date", label: "Wrong / No Mfg. Date" },
      { code: "expiry_date", label: "Wrong / No Expiry Date" },
      { code: "artwork", label: "Wrong Artwork Print" },
    ],
    carton: [
      { code: "lot_no", label: "Wrong / No Lot Number" },
      { code: "mfg_date", label: "Wrong / No Mfg. Date" },
      { code: "expiry_date", label: "Wrong / No Expiry Date" },
      { code: "artwork", label: "Wrong Artwork Print" },
      { code: "carton_no", label: "No Box/Carton #" },
    ],
  },
};

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
