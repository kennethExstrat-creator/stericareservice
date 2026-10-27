// Sampling Settings (Kenneth, 27 October 2026: "put a setting beside the auto
// calculation sampling, that is to set general inspection level"): the levels
// as the dialog groups them, and the words of its lines under them, which say
// where each level comes from. Two levels since the same day ("for dimension
// and FAB, use Special Inspection Level S2 ... so both general inspection and
// special inspection is in use"): the general one, and the special one with
// lines saying what each is for. The levels themselves are calc's
// (resolveInspectionLevel, resolveSpecialInspectionLevel).
import {
  GENERAL_INSPECTION_LEVELS,
  SPECIAL_INSPECTION_LEVELS,
  type GeneralInspectionLevel,
  type InspectionLevel,
  type SpecialInspectionLevel,
} from "@/lib/aql";
import type { SourcedLevel } from "./calc";

/** The general levels I, II and III, under General Inspection Level. */
export const GENERAL_LEVELS: readonly GeneralInspectionLevel[] = GENERAL_INSPECTION_LEVELS;

/** The special levels S-1 to S-4, under Special Inspection Level. */
export const SPECIAL_LEVELS: readonly SpecialInspectionLevel[] = SPECIAL_INSPECTION_LEVELS;

/** What each level is for, the dialog's two lines under them (Kenneth, 27 October 2026). */
export const LEVEL_USES = [
  "General: # of Gloves Sample and its code letter.",
  "Special: Dimension, FAB and Packaging & Dispensing.",
] as const;

/** "Template default: I.", "Client default: II.", "Default: S-2.": the level without one set for the inspection. */
export function defaultLevelText({ level, source }: SourcedLevel): string {
  if (source === "template") return `Template default: ${level}.`;
  if (source === "client") return `Client default: ${level}.`;
  return `Default: ${level}.`;
}

/**
 * The line under a level. `chosen` is the level picked for this inspection,
 * null while it takes the default (`fallback`), which the line names either
 * way: "Set for this inspection. Template default: I.".
 */
export function levelSourceText(chosen: InspectionLevel | null, fallback: SourcedLevel): string {
  return chosen === null ? defaultLevelText(fallback) : `Set for this inspection. ${defaultLevelText(fallback)}`;
}
