// Physical Properties' table: a row per average the lab report gives, in the
// order the report prints them, worded as the template words them (the
// unit is in its label: "Tensile Strength (Average) (MPa)", "Elongation at
// Break, Average (%)"), each size's value at the template's decimals as the
// module's summary prints it ("34.18", "536"), against the minimum every
// size shares, under the label ("≥ 14.00", "≥ 500"). Below it is red; an
// average of 0 or less is red too and says it is not valid, as its error
// does. The lab report the module requires is the module's, not a size's:
// its summary and issues say whether it is attached.
import { labelFor } from "@/modules/_framework";
import type { TensileComputed, TensileData } from "@/modules/tensile";
import { MEASURE_RULES, measureSpec } from "@/modules/tensile/calc";
import { TENSILE_MEASURES } from "@/modules/tensile/config";
import type { SizeTableAdapter } from "../size-table";
import { cell, issueTone, labelWithUnit, numberText, onCell, sizeRow, specText, tableOf, worstTone } from "./measures-format";

export const tensileTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as TensileComputed;
  const data = entry.data as TensileData | null;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.sizes || !computed.decimals || !data) return null;

  const rows = TENSILE_MEASURES.map((measure) => {
    const rule = MEASURE_RULES[measure];
    const decimals = computed.decimals[measure];
    return sizeRow(
      measure,
      labelWithUnit(labelFor(entry.labels, measure), rule.unit),
      context.sizes,
      (size) => {
        const value = data.sizes[size]?.[measure] ?? null;
        // An average of 0 or less: an error on its cell.
        const invalid = issueTone(entry.issues, (issue) => issue.level === "error" && onCell(issue, size, measure));
        if (value === null) return cell(null, { tone: invalid });
        const below = computed.sizes[size]?.[rule.result] === "fail" ? "fail" : undefined;
        return cell(numberText(value, { decimals }), {
          note: value <= 0 ? "Not Valid" : null,
          tone: worstTone(below, invalid),
        });
      },
      specText(measureSpec(computed, measure), decimals),
    );
  });
  return tableOf(rows);
};
