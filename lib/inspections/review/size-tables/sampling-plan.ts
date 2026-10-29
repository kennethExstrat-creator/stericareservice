// The Sampling Plan's table: its rows of counts as the capture screen lists
// them (rows.ts countGroups) and in their wording, # of Case to the counts
// each test takes ("# Gloves for Watertight & Visual", "# Gloves for
// Dimension", ...), one cell per size. Rows the template switches off are
// not there. A test row the inspector switched off, and the rows that are
// never asked for (the inner boxes taken per case, the code letter) or
// worked out (the gloves taken per inner box, those put back), show only
// where a size has a value. A code letter lowered on purpose says so ("Reduced
// From N"), as the summary does. Each cell takes the tone of the module's
// issues on it: an error (more cases than ordered, a sample below 2) red, a
// warning (a total that is not cases x inner boxes per case, a sample size
// that is not standard) amber. Gloves apart from the code letter's sample are
// no warning (Kenneth, 29 October 2026).
import { labelFor } from "@/modules/_framework";
import type { SamplingPlanComputed, SamplingPlanConfig, SamplingPlanData } from "@/modules/sampling_plan";
import { countGroups, type PlanRow } from "@/modules/sampling_plan/rows";
import { rowsOff, type RowSwitch, type SamplingCount } from "@/modules/sampling_plan/schema";
import type { SizeTableAdapter, SizeTableRow } from "../size-table";
import { cell, countText, issueTone, onCell, sizeRow, tableOf } from "./measures-format";

export const samplingPlanTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as SamplingPlanComputed;
  const config = entry.config as SamplingPlanConfig;
  const data = entry.data as SamplingPlanData | null;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.sizes || !data) return null;

  const sizes = context.sizes;
  const off = rowsOff(data);
  const stored = (size: string) => data.sizes[size];
  const toneOf = (size: string, key: string) => issueTone(entry.issues, (issue) => onCell(issue, size, key));
  const anyValue = (value: (size: string) => unknown) => sizes.some((size) => (value(size) ?? null) !== null);

  const rowOf = (row: PlanRow): SizeTableRow[] => {
    switch (row.kind) {
      case "count": {
        const { column, label } = row;
        const value = (size: string) => stored(size)?.[column] ?? null;
        // Never asked for, or switched off for this inspection: only with a value to show.
        const optional = column === "innerUnitsPerCase" || switchedOff(off, column);
        if (optional && !anyValue(value)) return [];
        return [sizeRow(column, label, sizes, (size) => cell(countText(value(size)), { tone: toneOf(size, column) }))];
      }
      case "worked": {
        const { key, label } = row;
        const value = (size: string) => computed.sizes[size]?.[key] ?? null;
        if (!anyValue(value)) return [];
        return [sizeRow(key, label, sizes, (size) => cell(countText(value(size))))];
      }
      case "letter": {
        const { key, label } = row;
        const letter = (size: string) => stored(size)?.codeLetter ?? null;
        if (!anyValue(letter)) return [];
        return [
          sizeRow(key, label, sizes, (size) => {
            const reducedFrom = computed.sizes[size]?.reducedFrom ?? null;
            return cell(letter(size), {
              note: reducedFrom === null ? null : `Reduced From ${reducedFrom}`,
              tone: toneOf(size, key),
            });
          }),
        ];
      }
    }
  };

  const wording = (key: string) => labelFor(entry.labels, key);
  return tableOf(countGroups(config, wording).flatMap((group) => group.rows.flatMap(rowOf)));
};

/** A test row the inspector switched off on screen (rowsOff): no longer asked for, what it holds still kept. */
function switchedOff(off: ReadonlySet<RowSwitch>, column: SamplingCount): boolean {
  return [...off].some((row) => row === column);
}
