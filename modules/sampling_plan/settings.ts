// Sampling Settings (Kenneth, 27 October 2026: "put a setting beside the auto
// calculation sampling, that is to set general inspection level"): the levels
// as the dialog groups them, and the words of its line under them, which say
// where the level comes from. The level itself is calc's
// (resolveInspectionLevel).
import { INSPECTION_LEVELS, type InspectionLevel } from "@/lib/aql";
import type { SourcedLevel } from "./calc";

/** The general levels I, II and III, which the dialog offers first. */
export const GENERAL_LEVELS: readonly InspectionLevel[] = INSPECTION_LEVELS.filter((level) => !level.startsWith("S-"));

/** The special levels S-1 to S-4, grouped under Special. */
export const SPECIAL_LEVELS: readonly InspectionLevel[] = INSPECTION_LEVELS.filter((level) => level.startsWith("S-"));

/** "Template default: I.", "Client default: II.", "Default: I.": the level without one set for the inspection. */
export function defaultLevelText({ level, source }: SourcedLevel): string {
  if (source === "template") return `Template default: ${level}.`;
  if (source === "client") return `Client default: ${level}.`;
  return `Default: ${level}.`;
}

/**
 * The line under the levels. `chosen` is the level picked for this
 * inspection, null while it takes the default (`fallback`), which the line
 * names either way: "Set for this inspection. Template default: I.".
 */
export function levelSourceText(chosen: InspectionLevel | null, fallback: SourcedLevel): string {
  return chosen === null ? defaultLevelText(fallback) : `Set for this inspection. ${defaultLevelText(fallback)}`;
}
