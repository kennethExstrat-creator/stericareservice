// The Sampling Quantity's worked-out counts (Kenneth, 27 October 2026). With
// the inner boxes taken from each sampled case entered, the inner boxes
// sampled in all are the cases times that ("add row "Inner Box Taken per
// Case", then Total # of Inner Box"). The gloves taken from each inner box
// reach the sample and never fall short of it; what they take beyond it is
// put back: 315 gloves from 25 inner boxes is 13 a box, 325 taken and 10 put
// back ("do not under take, over take it to the nearest of 315 ... Always
// use this method to calculate sample gloves taken per inner box").

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

/** The gloves taken in all: per box × inner boxes; null as glovesPerInnerBox is. */
export function glovesTaken(gloves: number | null, innerUnits: number | null): number | null {
  const perBox = glovesPerInnerBox(gloves, innerUnits);
  return perBox === null || innerUnits === null ? null : perBox * innerUnits;
}

/** The gloves taken beyond the sample, to put back: the gloves taken − gloves; null as glovesPerInnerBox is. */
export function glovesPutBack(gloves: number | null, innerUnits: number | null): number | null {
  const taken = glovesTaken(gloves, innerUnits);
  return taken === null || gloves === null ? null : taken - gloves;
}
