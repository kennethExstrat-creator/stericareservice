// Force at Break's table: each size's median of its readings ("Median (N)",
// "6.537") at the template's decimals, as the module's summary prints it,
// against the minimum every size shares, under the label ("≥ 6"). A median
// below it is red, and so is a size the module finds wrong data in (a
// reading of 0 N or less, readings past the gloves tested: errors). A size
// still waiting for readings shows a dash and how many are in.
import { labelFor } from "@/modules/_framework";
import type { ForceAtBreakComputed } from "@/modules/force_at_break";
import { forceSpec } from "@/modules/force_at_break/calc";
import type { SizeTableAdapter } from "../size-table";
import {
  cell,
  issueTone,
  labelWithUnit,
  NO_GLOVES_NOTE,
  numberText,
  onCell,
  readingsNote,
  sizeRow,
  specText,
  tableOf,
  worstTone,
} from "./measures-format";

export const forceAtBreakTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as ForceAtBreakComputed;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.sizes || typeof computed.specMin !== "number") return null;

  const median = sizeRow(
    "median",
    labelWithUnit(labelFor(entry.labels, "median"), "N"),
    context.sizes,
    (size) => {
      const own = computed.sizes[size];
      if (!own) return cell(null);
      const wrongData = issueTone(entry.issues, (issue) => issue.level === "error" && onCell(issue, size));
      if (own.median === null) {
        const progress = own.n === 0 ? NO_GLOVES_NOTE : own.entered > 0 ? readingsNote(own.entered, own.n) : null;
        return cell(null, { note: progress, tone: wrongData });
      }
      const below = own.result === "fail" ? "fail" : undefined;
      return cell(numberText(own.median, { decimals: computed.decimals }), { tone: worstTone(below, wrongData) });
    },
    specText(forceSpec(computed)),
  );
  // A size with readings in shows them coming, before any size has its median.
  return tableOf([median], context.sizes.some((size) => (computed.sizes[size]?.entered ?? 0) > 0));
};
