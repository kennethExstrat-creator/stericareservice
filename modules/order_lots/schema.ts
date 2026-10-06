// The order table on page 1 of both reports (BUILD_SPEC 6.1 order_lots): per
// size, the quantity in cases, the lot numbers and the packing site. A size
// with a quantity is ordered, and only ordered sizes appear in any module
// (6.2 rule 4), so this module is the source of the sizes rather than a
// per-size module itself: its lines are keyed by canonical size under `sizes`
// for every size the template offers, ordered or not.
import { z } from "zod";
import { CountCellSchema, perSizeData, TextCellSchema } from "@/modules/_framework";

export const OrderLineSchema = z.strictObject({
  /** Cases ordered: a whole number (rule 1). Blank or 0: the size is not ordered. */
  qtyCases: CountCellSchema,
  /** One or more lots per size, as printed: "LOT-A01". */
  lotNumbers: z.array(z.string().max(200)).default([]),
  /** The site that packed the size's lot, as printed (SAFEDON_EG); config.fields.packingSite shows it. */
  packingSite: TextCellSchema,
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

export const OrderLotsDataSchema = perSizeData(OrderLineSchema);
export type OrderLotsData = z.infer<typeof OrderLotsDataSchema>;

export function emptyOrderLots(): OrderLotsData {
  return OrderLotsDataSchema.parse({});
}

export function emptyOrderLine(): OrderLine {
  return OrderLineSchema.parse({});
}
