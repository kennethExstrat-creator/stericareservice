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
import { columnGroups, type SamplingColumn, type SamplingPlanConfig } from "./config";

export type CountRow = {
  column: SamplingColumn;
  /** The template's wording, for the cells' names. */
  label: string;
  /** What the row shows under its heading. */
  shown: string;
};

export type CountGroup = {
  /** Null for counts whose labels share no "# … for" start: they follow a plain divider. */
  heading: string | null;
  rows: CountRow[];
};

/** "# Gloves for Dimension": what is counted, and for what. */
const COUNTED_FOR = /^(#\s*\S.*?)\s+for\s+(\S.*)$/i;

export function countGroups(config: SamplingPlanConfig, label: (key: string) => string): CountGroup[] {
  const { quantity, tests } = columnGroups(config);
  const groups: CountGroup[] = [];
  if (quantity.length > 0) {
    groups.push({
      heading: label("samplingQuantity"),
      rows: quantity.map((column) => ({ column, label: label(column), shown: label(column) })),
    });
  }
  // Tests next to each other that count the same thing share a heading.
  const runs: { counted: string | null; rows: CountRow[] }[] = [];
  for (const column of tests) {
    const wording = label(column);
    const match = COUNTED_FOR.exec(wording);
    const counted = match ? match[1] : null;
    const row: CountRow = { column, label: wording, shown: match ? match[2] : wording };
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
