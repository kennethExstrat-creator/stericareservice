// The Sampling Plan table's rows of counts (Capture.tsx), grouped under
// headings as the onsite forms group them (config.ts columnGroups): what was
// sampled under the template's "Sampling Quantity", then the counts each test
// takes. Kenneth's layout (26 October 2026, design B "Sizes as Columns") heads
// the tests by what they count: "# Gloves for Watertight & Visual" and
// "# Gloves for Dimension" become "Watertight & Visual" and "Dimension" under
// "# Gloves for Each Test", "# Inner Box for Packaging & Dispensing
// Inspection" becomes "Packaging & Dispensing Inspection" under "# Inner Box".
// The template's whole wording stays the cells' names. A label not worded
// "# … for …" (the SG form's "# Gloves (FAB)") keeps its wording as it is.
// Sampling Quantity has four rows no column switch names (Kenneth, 27
// October 2026): the inner boxes taken per case, typed, before the inner
// boxes in all; and the gloves taken per inner box, the gloves taken in all
// and those put back, worked out, before the gloves sampled ("glove taken
// per box, total gloves taken, put back, # of Gloves Sample").
import {
  columnGroups,
  showsGlovesPerInnerBox,
  showsInnerUnitsPerCase,
  type SamplingPlanConfig,
} from "./config";
import type { SamplingSize } from "./schema";

/** A row of whole-number cells, one per size. */
export type CountRow = {
  kind: "count";
  column: keyof SamplingSize;
  /** The template's wording, for the cells' names. */
  label: string;
  /** What the row shows under its heading. */
  shown: string;
};

/** A row worked out from the counts above it (calc's computed values), never typed. */
export type WorkedRow = {
  kind: "worked";
  key: "glovesPerInnerBox" | "totalGlovesTaken" | "putBack";
  label: string;
};

export type PlanRow = CountRow | WorkedRow;

export type CountGroup = {
  /** Null for counts whose labels share no "# … for" start: they follow a plain divider. */
  heading: string | null;
  rows: PlanRow[];
};

/** "# Gloves for Dimension": what is counted, and for what. */
const COUNTED_FOR = /^(#\s*\S.*?)\s+for\s+(\S.*)$/i;

export function countGroups(config: SamplingPlanConfig, label: (key: string) => string): CountGroup[] {
  const { quantity, tests } = columnGroups(config);
  const groups: CountGroup[] = [];
  const count = (column: keyof SamplingSize): CountRow => ({ kind: "count", column, label: label(column), shown: label(column) });
  const worked = (key: WorkedRow["key"]): WorkedRow => ({ kind: "worked", key, label: label(key) });
  if (quantity.length > 0) {
    const rows = quantity.flatMap((column): PlanRow[] => {
      if (column === "innerUnits" && showsInnerUnitsPerCase(config)) return [count("innerUnitsPerCase"), count(column)];
      if (column === "gloves" && showsGlovesPerInnerBox(config)) {
        return [worked("glovesPerInnerBox"), worked("totalGlovesTaken"), worked("putBack"), count(column)];
      }
      return [count(column)];
    });
    groups.push({ heading: label("samplingQuantity"), rows });
  }
  // Tests next to each other that count the same thing share a heading.
  const runs: { counted: string | null; rows: CountRow[] }[] = [];
  for (const column of tests) {
    const wording = label(column);
    const match = COUNTED_FOR.exec(wording);
    const counted = match ? match[1] : null;
    const row: CountRow = { kind: "count", column, label: wording, shown: match ? match[2] : wording };
    const last = runs.at(-1);
    if (last && last.counted === counted) last.rows.push(row);
    else runs.push({ counted, rows: [row] });
  }
  for (const run of runs) {
    const heading = run.counted === null ? null : run.rows.length > 1 ? `${run.counted} for Each Test` : run.counted;
    groups.push({ heading, rows: run.rows });
  }
  return groups;
}
