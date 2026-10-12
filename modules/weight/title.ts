// Weight's title as this inspection shows it (ModuleDefinition.shownTitle).
// The template words the gloves weighed per size ("Weight (g) - Average of
// 13 Gloves per Size", STD_EG); the count follows the gloves this inspection
// really weighs (glovesFor), so the step list, every message, the review and
// the export say 12 when the sampling plan has 12 gloves for dimension. The
// stored wording, and a title with no count ("Weight (g)", SAFEDON_EG), stay
// as they are.
import { fillGloveCount, type TitleInput } from "@/modules/_framework";
import { glovesFor } from "./calc";
import type { WeightConfig } from "./config";

/**
 * The gloves weighed per size, as one number or several ("8 or 13"). A size
 * the plan gives no gloves for dimension is left out beside the others (it is
 * not done: nothing to weigh); 0 only when every size has none. With no size
 * ordered yet, the template's n.
 */
export function weightTitle({ title, config, context }: TitleInput<WeightConfig>): string {
  const counts = [...new Set(context.sizes.map((size) => glovesFor(context, size, config).n))];
  if (counts.length === 0) return fillGloveCount(title, [config.n]);
  const weighed = counts.filter((count) => count > 0);
  return fillGloveCount(title, weighed.length > 0 ? weighed : counts);
}
