// Weight's table: each size's average weight ("Average (g)", "2.90") at the
// template's decimals, as the module's summary prints it, its spec where the
// template sets one (NA, as SAFEDON_EG prints it, is none), and the
// indicative weight under the size it is given for ("Indicative 3.5"). A
// spec the weight fails is red, as is a weight of 0 g or less (an error).
// Where a size is compared with its indicative weight, a second row gives
// the deviation as the summary words it ("17.1% below"), amber beyond the
// template's threshold, which sits under its label ("Threshold 10%"), as
// the module warns.
import { formatNumber } from "@/lib/format";
import { labelFor } from "@/modules/_framework";
import type { WeightComputed, WeightConfig } from "@/modules/weight";
import { indicativeFor } from "@/modules/weight/calc";
import type { SizeTableAdapter, SizeTableRow } from "../size-table";
import {
  cell,
  issueTone,
  joinNote,
  labelWithUnit,
  numberText,
  onCell,
  placeSpecs,
  sizeRow,
  specText,
  tableOf,
  worstTone,
} from "./measures-format";

export const weightTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as WeightComputed;
  const config = entry.config as WeightConfig;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.shown || !computed.spec || !computed.result || !computed.deviationPct) return null;

  const specs = placeSpecs(context.sizes, (size) => specText(computed.spec[size]));
  const average = sizeRow(
    "average",
    labelWithUnit(labelFor(entry.labels, "average"), "g"),
    context.sizes,
    (size) => {
      const indicative = indicativeFor(context, size);
      const failed = computed.result[size] === "fail" ? "fail" : undefined;
      const invalid = issueTone(entry.issues, (issue) => issue.level === "error" && onCell(issue, size, "values"));
      return cell(numberText(computed.shown[size], { decimals: config.decimals }), {
        note: joinNote(specs.note(size), indicative ? `Indicative ${formatNumber(indicative.grams)}` : null),
        tone: worstTone(failed, invalid),
      });
    },
    specs.spec,
  );

  const rows: SizeTableRow[] = [average];
  if (context.sizes.some((size) => computed.deviationPct[size] !== undefined)) {
    rows.push(
      sizeRow(
        "deviationPct",
        labelFor(entry.labels, "deviationPct"),
        context.sizes,
        (size) => {
          const deviation = computed.deviationPct[size];
          if (deviation === undefined) return cell(null);
          // Beyond the threshold, the module's warning (weight_deviation).
          const beyond = issueTone(entry.issues, (issue) => issue.code === "weight_deviation" && issue.size === size);
          return cell(deviationText(deviation), { tone: beyond });
        },
        `Threshold ${formatNumber(computed.warnThresholdPct)}%`,
      ),
    );
  }
  return tableOf(rows);
};

/** "17.1% below", "2.3% above", as the summary words the deviation from the indicative weight; "0%" when it is the same. */
function deviationText(deviation: number): string {
  if (deviation === 0) return "0%";
  return `${formatNumber(Math.abs(deviation))}% ${deviation < 0 ? "below" : "above"}`;
}
