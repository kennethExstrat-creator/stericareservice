// Box/carton numbers (BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026: box #
// and carton # are one number, "yes link again", reversing 12 October). The
// number typed in dispensing_packing, dispensing_safedon and labeling is one
// of the size's sampled carton numbers (carton_sampling's list, `cartonsFor`).
// A number the size's list does not hold is a warning on its field: listed
// with a link, in the export, never an error, never a result. The same number
// in several rows is no problem (one carton can supply several inner boxes),
// and while the size has no list (carton sampling switched off or not filled
// in yet) nothing is checked.
import { BOX_CARTON_NUMBERS, boxCartonNumber } from "@/lib/format/box-carton";
import { warningIssue, type CalcIssue, type IssuePath } from "@/lib/validation/issues";
import { cartonsFor, sizeLabel, type InspectionContext } from "./context";

/** The issue code of a box/carton number the size's sampled list does not hold. */
export const BOX_NOT_SAMPLED = "box_not_in_carton_list";

/**
 * The warning for `box` in row `path` of size `size`, or null when there is
 * nothing to say: no number, no sampled list for the size yet, or a number
 * the list holds. "Box/Carton #2336 is not in M's sampled box/carton numbers."
 */
export function boxNotSampledIssue(
  context: InspectionContext,
  size: string,
  box: number | null,
  path: IssuePath,
): CalcIssue | null {
  const cartons = cartonsFor(context, size);
  if (box === null || cartons.length === 0 || cartons.includes(box)) return null;
  return warningIssue(
    BOX_NOT_SAMPLED,
    `${boxCartonNumber(box)} is not in ${sizeLabel(context, size)}'s sampled ${BOX_CARTON_NUMBERS}.`,
    { size, path },
  );
}
