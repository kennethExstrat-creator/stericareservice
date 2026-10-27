// Dye Leak Test's table, in the template's wording: the pouches the plan asks
// for (the sampling plan's dye leak pouches, else the template's n), those
// tested and those that leaked, per size. A leak fails the size: red. Fewer
// pouches tested than planned is amber, as the module warns, and more
// failed than tested is red, as its error is. The notes stay on the capture
// screen: they are the inspector's words, not a figure.
import { labelFor } from "@/modules/_framework";
import type { DyeLeakComputed, DyeLeakData } from "@/modules/dye_leak";
import type { SizeTableAdapter, SizeTableRow } from "../size-table";
import { cell, countText, issueTone, onCell, sizeRow, tableOf, worstTone } from "./measures-format";

export const dyeLeakTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as DyeLeakComputed;
  const data = entry.data as DyeLeakData | null;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.result || !computed.pouchesPlanned || !data) return null;

  const label = (key: string) => labelFor(entry.labels, key);
  const counts = (size: string) => data.sizes[size];
  const isCounted = (size: string) =>
    (counts(size)?.pouchesTested ?? null) !== null || (counts(size)?.pouchesFailed ?? null) !== null;
  // Nothing tested yet: the plan alone is no result, the review shows the module's summary.
  if (!context.sizes.some(isCounted)) return null;

  const rows: SizeTableRow[] = [];
  if (context.sizes.some((size) => (computed.pouchesPlanned[size] ?? null) !== null)) {
    rows.push(sizeRow("pouchesPlanned", label("pouchesPlanned"), context.sizes, (size) => cell(countText(computed.pouchesPlanned[size]))));
  }
  rows.push(
    sizeRow("pouchesTested", label("pouchesTested"), context.sizes, (size) =>
      // Below the plan: the module's warning (dye_leak_below_plan).
      cell(countText(counts(size)?.pouchesTested), { tone: issueTone(entry.issues, (issue) => onCell(issue, size, "pouchesTested")) }),
    ),
    sizeRow("pouchesFailed", label("pouchesFailed"), context.sizes, (size) => {
      const leaked = computed.result[size] === "fail" ? "fail" : undefined;
      // More failed than tested: the module's error (dye_leak_failed_above_tested).
      const wrong = issueTone(entry.issues, (issue) => onCell(issue, size, "pouchesFailed"));
      return cell(countText(counts(size)?.pouchesFailed), { tone: worstTone(leaked, wrong) });
    }),
  );
  return tableOf(rows);
};
