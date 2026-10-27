// Auto Calculate Sampling's # of Gloves (Kenneth, 27 October 2026: "For each
// size, based on the TOTAL gloves quantity of each size (the lot size),
// determine which code letter and hence the sampling number (based on
// General Inspection Level I <--- and this can be changed in setting"). Each
// size's lot in gloves (its order cases × the packing configuration's gloves
// per case) gives its ISO 2859-1 Table 1 code letter at the general level
// in force (calc's resolveInspectionLevel: the one Sampling Settings set for
// the inspection, the template's, the client's, else I), and that letter's
// sample size is the gloves to sample (code-letters.ts sizeCodeLetters: a lot
// of 150,001 to 500,000 gloves at level I is code M, 315 gloves). A sample not
// smaller than the lot means every glove (docs/AQL.md rule 8). The letter
// goes into the size's Code Letter row with it (Kenneth, 27 October 2026). A
// size whose lot is not known keeps its # of Gloves and its letter, and Auto
// Calculate says why in its notice. The general level only: Dimension, FAB
// and Packaging & Dispensing are filled at the special level (auto-special.ts,
// since 27 October 2026).
import type { CodeLetter, InspectionLevel } from "@/lib/aql";
import { sizeCodeLetters, type SizeLot } from "./code-letters";
import { letterSample } from "./letter-steps";

export type AutoGloves = {
  /** Each size's gloves to sample, for the sizes whose lot is known. */
  gloves: Record<string, number>;
  /** The code letter of each of those sizes' lots, which its gloves come from. */
  letters: Record<string, CodeLetter>;
  /** The sizes whose lot in gloves is not known, in order: their # of Gloves and code letter are left as they are. */
  unknownLot: string[];
};

export function autoSampleGloves(lots: readonly SizeLot[], level: InspectionLevel): AutoGloves {
  const gloves: Record<string, number> = {};
  const letters: Record<string, CodeLetter> = {};
  const unknownLot: string[] = [];
  // A lot of fewer than 2 gloves has no Table 1 row, so no code letter: no lot to work from.
  for (const { size, lot, codeLetter } of sizeCodeLetters(lots, level)) {
    if (lot === null || codeLetter === null) {
      unknownLot.push(size);
      continue;
    }
    gloves[size] = letterSample(codeLetter, lot);
    letters[size] = codeLetter;
  }
  return { gloves, letters, unknownLot };
}

/** Auto Calculate Sampling's toast, whatever it filled (Kenneth, 27 October 2026). */
export const AUTO_CALCULATED_TITLE = "Sampling Plan Calculation Completed";

export type AutoCalculateNotice = {
  title: string;
  /** One line naming what could not be worked out; null when everything was. */
  description: string | null;
};

/** What a row whose lot in gloves is not known lacks, as the notice words it. */
export const NEEDS_LOT_SIZE = "the lot size";

/** A row Auto Calculate Sampling left for some sizes, for want of what its count is worked out from. */
export type LeftRow = {
  /** The row as the table shows it: "Dimension", "Packaging & Dispensing Inspection". */
  label: string;
  /** What it lacks: "the lot size", "the inner boxes per case". */
  needs: string;
  /** The sizes it left, in order. */
  sizes: readonly string[];
};

/**
 * What Auto Calculate Sampling says once it has filled the plan: the title
 * alone, or with one line naming the rows it left for some sizes, and why:
 * "# of Gloves Sample needs the lot size for S, XL: enter the packing
 * configuration on the Order page." Rows that lack the same for the same
 * sizes share a sentence ("# of Gloves Sample, Dimension and FAB need the
 * lot size for S, XL: …"); the special level's rows (auto-special.ts) come
 * in `rows`, after the gloves'.
 */
export function autoCalculateNotice({
  unknownLot,
  sizeName,
  glovesLabel,
  orderPage,
  rows = [],
}: {
  unknownLot: readonly string[];
  sizeName: (size: string) => string;
  /** The gloves row's label ("# of Gloves Sample"). */
  glovesLabel: string;
  /** The capture page that holds the packing configuration: the order's ("Order"). */
  orderPage: string;
  /** The other rows left: Dimension, FAB, Packaging & Dispensing Inspection. */
  rows?: readonly LeftRow[];
}): AutoCalculateNotice {
  const left = [{ label: glovesLabel, needs: NEEDS_LOT_SIZE, sizes: unknownLot }, ...rows].filter((row) => row.sizes.length > 0);
  if (left.length === 0) return { title: AUTO_CALCULATED_TITLE, description: null };
  const sentences = new Map<string, { labels: string[]; needs: string; sizes: readonly string[] }>();
  for (const row of left) {
    const key = JSON.stringify([row.needs, row.sizes]);
    const shared = sentences.get(key);
    if (shared) shared.labels.push(row.label);
    else sentences.set(key, { labels: [row.label], needs: row.needs, sizes: row.sizes });
  }
  const description = Array.from(
    sentences.values(),
    ({ labels, needs, sizes }) =>
      `${wordList(labels)} ${labels.length === 1 ? "needs" : "need"} ${needs} for ${sizes.map(sizeName).join(", ")}: enter the packing configuration on the ${orderPage} page.`,
  ).join(" ");
  return { title: AUTO_CALCULATED_TITLE, description };
}

/** "Dimension", "Dimension and FAB", "# of Gloves Sample, Dimension and FAB". */
function wordList(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
