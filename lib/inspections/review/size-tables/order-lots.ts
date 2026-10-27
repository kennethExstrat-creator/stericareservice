// The order's table, as its capture screen has its columns and in the
// template's wording: each ordered size's quantity in cases ("Qty (Cases)",
// "2,900"), its lot numbers as entered ("Lot Number"), its packing site
// where the template shows the column, and the lot size in gloves the
// sampling plan starts from (computed: cases x gloves per case; a dash until
// the packing configuration gives the gloves per case). A lot number entered
// twice for a size is amber, as the module warns.
import { labelFor } from "@/modules/_framework";
import type { OrderLotsComputed, OrderLotsConfig, OrderLotsData } from "@/modules/order_lots";
import { readOrder } from "@/modules/order_lots/calc";
import type { SizeTableAdapter, SizeTableRow } from "../size-table";
import { cell, countText, issueTone, sizeRow, tableOf } from "./measures-format";

export const orderLotsTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as OrderLotsComputed;
  const config = entry.config as OrderLotsConfig;
  const data = entry.data as OrderLotsData | null;
  // A module whose settings or data could not be read computes nothing.
  if (!computed.lotSizeGloves || !data) return null;

  const label = (key: string) => labelFor(entry.labels, key);
  // Each size's line as the module reads it: by canonical size, lot numbers trimmed, blanks left out.
  const lines = new Map(readOrder(data, context.templateSizes).rows.map((row) => [row.size, row]));
  const rows: SizeTableRow[] = [
    sizeRow("qtyCases", label("qtyCases"), context.sizes, (size) => cell(countText(lines.get(size)?.qtyCases))),
    sizeRow("lotNumbers", label("lotNumbers"), context.sizes, (size) => {
      const lots = lines.get(size)?.lotNumbers ?? [];
      // A lot number entered twice: the module's warning (lot_number_duplicate).
      const twice = issueTone(entry.issues, (issue) => issue.size === size && issue.path[2] === "lotNumbers");
      return cell(lots.length === 0 ? null : lots.join(", "), { tone: twice });
    }),
  ];
  if (config.fields.packingSite) {
    rows.push(sizeRow("packingSite", label("packingSite"), context.sizes, (size) => cell(lines.get(size)?.packingSite ?? null)));
  }
  rows.push(sizeRow("lotSizeGloves", label("lotSizeGloves"), context.sizes, (size) => cell(countText(computed.lotSizeGloves[size]))));
  return tableOf(rows);
};
