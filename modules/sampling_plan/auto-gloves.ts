// Auto Calculate Sampling's # of Gloves (Kenneth, 27 October 2026: "For each
// size, based on the TOTAL gloves quantity of each size (the lot size),
// determine which code letter and hence the sampling number (based on
// General Inspection Level I <--- and this can be changed in setting"). Each
// size's lot in gloves (its order cases × the packing configuration's gloves
// per case) gives its ISO 2859-1 Table 1 code letter at the inspection level
// in force (calc's resolveInspectionLevel: the one Sampling Settings set for
// the inspection, the template's, the client's, else I), and that letter's
// sample size is the gloves to sample (code-letters.ts sizeCodeLetters: a lot
// of 150,001 to 500,000 gloves at level I is code M, 315 gloves). A sample not
// smaller than the lot means every glove (docs/AQL.md rule 8). A size whose
// lot is not known keeps its # of Gloves, and Auto Calculate says why in its
// notice.
import type { InspectionLevel } from "@/lib/aql";
import { sizeCodeLetters, type SizeLot } from "./code-letters";

export type AutoGloves = {
  /** Each size's gloves to sample, for the sizes whose lot is known. */
  gloves: Record<string, number>;
  /** The sizes whose lot in gloves is not known, in order: their # of Gloves is left as it is. */
  unknownLot: string[];
};

export function autoSampleGloves(lots: readonly SizeLot[], level: InspectionLevel): AutoGloves {
  const gloves: Record<string, number> = {};
  const unknownLot: string[] = [];
  // A lot of fewer than 2 gloves has no Table 1 row, so no sample size: no lot to work from.
  for (const { size, lot, sampleSize } of sizeCodeLetters(lots, level)) {
    if (lot === null || sampleSize === null) unknownLot.push(size);
    else gloves[size] = Math.min(sampleSize, lot);
  }
  return { gloves, unknownLot };
}

/** Auto Calculate Sampling's toast, whatever it filled (Kenneth, 27 October 2026). */
export const AUTO_CALCULATED_TITLE = "Sampling Plan Calculation Completed";

export type AutoCalculateNotice = {
  title: string;
  /** One line naming what could not be worked out; null when everything was. */
  description: string | null;
};

/**
 * What Auto Calculate Sampling says once it has filled the plan: the title
 * alone, or with one line naming the sizes whose # of Gloves it left for want
 * of a lot size: "# of Gloves Sample needs the lot size for S, XL: enter the
 * packing configuration on the Order page."
 */
export function autoCalculateNotice({
  unknownLot,
  sizeName,
  glovesLabel,
  orderPage,
}: {
  unknownLot: readonly string[];
  sizeName: (size: string) => string;
  /** The gloves row's label ("# of Gloves Sample"). */
  glovesLabel: string;
  /** The capture page that holds the packing configuration: the order's ("Order"). */
  orderPage: string;
}): AutoCalculateNotice {
  if (unknownLot.length === 0) return { title: AUTO_CALCULATED_TITLE, description: null };
  return {
    title: AUTO_CALCULATED_TITLE,
    description: `${glovesLabel} needs the lot size for ${unknownLot.map(sizeName).join(", ")}: enter the packing configuration on the ${orderPage} page.`,
  };
}
