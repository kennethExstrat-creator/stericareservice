// Dimension's table: a row per measure the template switches on, in its
// column order ("Length (mm)", "Width (mm)", ...), and each size's median or
// average of it (computed.statisticKind, which the table's caption names, not
// each row) at the template's decimals, as the module's summary prints it. A
// spec every size shares sits under the label ("≥ 240"); one that differs by
// size goes in the size's cell ("80 ± 10", "95 ± 10"); an NA spec nowhere.
// Out of spec is red (measureResult); a P/F set by hand says so in the cell
// ("Passed by the Inspector"), amber where the readings give the other
// verdict, as the module warns, and a reading of 0 mm or less is red, as its
// error is. A size still missing readings shows a dash and how many are in.
import { labelFor, type ModuleEvaluation, type ValidationIssue } from "@/modules/_framework";
import type { DimensionsComputed } from "@/modules/dimensions";
import type { Measure } from "@/modules/dimensions/config";
import type { SizeTableAdapter, SizeTableCell } from "../size-table";
import {
  cell,
  issueTone,
  joinNote,
  labelWithUnit,
  NO_GLOVES_NOTE,
  numberText,
  onCell,
  placeSpecs,
  readingsNote,
  sizeRow,
  specText,
  tableOf,
  worstTone,
} from "./measures-format";

export const dimensionsTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as DimensionsComputed;
  // A module whose settings or data could not be read computes nothing.
  if (!Array.isArray(computed.measures) || !computed.rows || !computed.spec) return null;

  const rows = computed.measures.map((measure) => {
    const specs = placeSpecs(context.sizes, (size) => {
      const own = computed.spec[size];
      return own === undefined ? undefined : specText(own[measure]);
    });
    const label = labelWithUnit(labelFor(entry.labels, measure), "mm");
    return sizeRow(measure, label, context.sizes, (size) => measureCell(entry, computed, size, measure, specs.note(size)), specs.spec);
  });
  // A size with readings in shows them coming, before any measure is complete.
  const entered = context.sizes.some((size) => computed.measures.some((measure) => (computed.count[size]?.[measure] ?? 0) > 0));
  const table = tableOf(rows, entered);
  // Every value is the statistic, named in the table's corner in the template's word ("Median", "Average").
  return table && { ...table, corner: labelFor(entry.labels, "statistic") };
};

function measureCell(
  entry: ModuleEvaluation,
  computed: DimensionsComputed,
  size: string,
  measure: Measure,
  specNote: string | undefined,
): SizeTableCell {
  const gloves = computed.rows[size];
  const count = computed.count[size]?.[measure];
  // The sampling plan has no gloves for dimension: nothing to measure.
  if (gloves === 0) return cell(null, { note: joinNote(specNote, NO_GLOVES_NOTE) });
  if (gloves === undefined || count === undefined) return cell(null, { note: specNote });
  // A reading of 0 mm or less, an error that blocks submit: red wherever it stands.
  const invalid = issueTone(entry.issues, (issue) => issue.level === "error" && isReadingOf(issue, size, measure));
  if (count < gloves) {
    const progress = count > 0 ? readingsNote(count, gloves) : null;
    return cell(null, { note: joinNote(specNote, progress), tone: invalid });
  }

  const manual = computed.manual[size]?.[measure];
  const byHand = manual ? `${labelFor(entry.labels, manual.result)} by the Inspector` : null;
  // The module warns where a P/F set by hand is not the readings' (pass_fail_changed).
  const changed = issueTone(entry.issues, (issue) => onCell(issue, size, "manualResults", measure));
  const outOfSpec = computed.measureResult[size]?.[measure] === "fail" ? "fail" : undefined;
  return cell(numberText(computed.shown[size]?.[measure], { decimals: computed.decimals[measure] }), {
    note: joinNote(specNote, byHand),
    tone: worstTone(outOfSpec, changed, invalid),
  });
}

/** An issue on one glove's reading of the measure: `["sizes", size, "gloves", glove, measure]`. */
function isReadingOf(issue: Pick<ValidationIssue, "path">, size: string, measure: Measure): boolean {
  return onCell(issue, size, "gloves") && issue.path[4] === measure;
}
