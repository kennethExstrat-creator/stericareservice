// Weight's title as this inspection shows it (ModuleDefinition.shownTitle).
// The step records one value per size, the size's average weight as the
// dimension sheet prints it (Kenneth, 26 October 2026), so a title naming
// the gloves weighed per size ("Weight (g) - Average of 13 Gloves per Size",
// STD_EG) reads "Weight (g)" in the step list, every message, the review and
// the export. The stored wording, and a title with no count ("Weight (g)",
// SAFEDON_EG), stay as they are.
import type { TitleInput } from "@/modules/_framework";
import type { WeightConfig } from "./config";

/** " - Average of 13 Gloves per Size" closing a title, in any case, with a hyphen or an en dash. */
const GLOVES_PER_SIZE = /\s*[-–]\s*average of \d+(?:\s+or\s+\d+)?\s+gloves?\s+per\s+size\s*$/i;

export function weightTitle({ title }: TitleInput<WeightConfig>): string {
  return title.replace(GLOVES_PER_SIZE, "");
}
