// What the capture body reads from calc for its grid, kept pure so it is
// tested without a browser.
import type { MeasureSummary } from "@/components/qc";
import type { ForceAtBreakSizeComputed } from "./calc";

/**
 * calc's figures for a size's grid footer: the median once every reading is
 * in, and the verdict, so the footer never shows a median or "Passed" for a
 * size calc says is not done (a reading of 0 N saved another way).
 * Undefined before the first evaluation: the grid then summarises its cells.
 */
export function readingSummary(computed: ForceAtBreakSizeComputed | undefined): MeasureSummary | undefined {
  if (!computed) return undefined;
  return { statistic: computed.median, outcome: computed.result, count: computed.entered };
}
