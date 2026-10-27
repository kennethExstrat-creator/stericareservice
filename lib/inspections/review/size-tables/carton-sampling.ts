// Finished Goods Sampling Information's table: what its summary says of each
// size ("13 box/carton numbers, unique and between 1 and 2,900") as rows.
// The box/carton numbers entered against the cases the sampling plan samples
// (the template's "Sampling Quantity", "13 / 13", as the capture screen
// shows it), how many of them are unique, and the range they must be in,
// 1 to the cases ordered ("Between", "1 and 2,900"). Each is red where the
// module's errors say so (6.2 rule 6): more numbers than cases sampled, a
// number entered twice, a number past the order quantity.
import { formatCount, formatRatio } from "@/lib/format";
import { labelFor } from "@/modules/_framework";
import type { CartonSamplingComputed } from "@/modules/carton_sampling";
import type { SizeTableAdapter } from "../size-table";
import { cell, countText, issueTone, sizeRow, tableOf } from "./measures-format";

export const cartonSamplingTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as CartonSamplingComputed;
  // A module whose data could not be read computes nothing.
  if (!computed.sizes) return null;

  const facts = (size: string) => computed.sizes[size];
  // No box/carton number entered yet: the review shows the module's summary.
  if (!context.sizes.some((size) => (facts(size)?.samplingQuantity ?? 0) > 0)) return null;
  const error = (size: string, code: string) => issueTone(entry.issues, (issue) => issue.code === code && issue.size === size);

  return tableOf([
    sizeRow("samplingQuantity", labelFor(entry.labels, "samplingQuantity"), context.sizes, (size) => {
      const own = facts(size);
      if (!own) return cell(null);
      return cell(formatRatio(own.samplingQuantity, own.sampledCases, { spaced: true, grouping: true }), {
        tone: error(size, "carton_count_above_cases"),
      });
    }),
    sizeRow("unique", "Unique", context.sizes, (size) =>
      cell(countText(facts(size)?.unique), { tone: error(size, "carton_duplicate") }),
    ),
    sizeRow("range", "Between", context.sizes, (size) => {
      const ordered = facts(size)?.orderQty ?? null;
      return cell(ordered === null ? null : `1 and ${formatCount(ordered)}`, { tone: error(size, "carton_out_of_range") });
    }),
  ]);
};
