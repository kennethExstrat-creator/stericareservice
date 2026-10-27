// The Sampling Quantity's worked-out counts (Kenneth, 27 October 2026). With
// the inner boxes taken from each sampled case entered, the inner boxes
// sampled in all are the cases times that ("add row "Inner Box Taken per
// Case", then Total # of Inner Box"). The gloves taken from each inner box
// reach the sample and never fall short of it; what they take beyond it is
// put back: 315 gloves from 25 inner boxes is 13 a box, 10 put back ("do not
// under take, over take it to the nearest of 315 ... Always use this method
// to calculate sample gloves taken per inner box"). The gloves taken in all
// have no row (Kenneth, 27 October 2026: "remove this row"): the sum beside #
// of Gloves Sample shows them instead, "(15 × 34) − 10" for 500.
import { formatCount } from "@/lib/aql";

/**
 * The inner boxes Auto Calculate Sampling takes from each case where a size
 * has no number for it (Kenneth, 27 October 2026, asked how it should fill
 * Inner Box Taken per Case: "Always 1 per case"); a number entered stays.
 */
export const AUTO_INNER_UNITS_PER_CASE = 1;

/** The inner boxes sampled in all: cases × inner boxes per case; null until both are entered. */
export function innerUnitsFromCases(cases: number | null, perCase: number | null): number | null {
  return cases === null || perCase === null ? null : cases * perCase;
}

/** The gloves to take from each inner box, ⌈gloves ÷ inner boxes⌉; null until both are entered, and with no inner box. */
export function glovesPerInnerBox(gloves: number | null, innerUnits: number | null): number | null {
  return gloves === null || innerUnits === null || innerUnits <= 0 ? null : Math.ceil(gloves / innerUnits);
}

/** The gloves taken beyond the sample, to put back: per box × inner boxes − gloves; null as glovesPerInnerBox is. */
export function glovesPutBack(gloves: number | null, innerUnits: number | null): number | null {
  const perBox = glovesPerInnerBox(gloves, innerUnits);
  return perBox === null || gloves === null || innerUnits === null ? null : perBox * innerUnits - gloves;
}

/**
 * The sum at the left of a # of Gloves Sample cell (Kenneth, 27 October
 * 2026: "for # of glove sample 500, the formula should be (15 x 34)-10"):
 * Total # of Inner Box × Gloves Taken per Inner Box − Put Back, "(15 × 34) −
 * 10", or "25 × 12" with none put back; null until the inner boxes and the
 * gloves per inner box are known.
 */
export function glovesFormula(innerUnits: number | null, perBox: number | null, putBack: number | null): string | null {
  if (innerUnits === null || perBox === null) return null;
  const taken = `${formatCount(innerUnits)} × ${formatCount(perBox)}`;
  return putBack === null || putBack === 0 ? taken : `(${taken}) − ${formatCount(putBack)}`;
}
