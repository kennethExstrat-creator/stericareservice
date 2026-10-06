// Loading (BUILD_SPEC 6.1 loading): the container and its seal, the cartons
// loaded and their condition. The cartons ordered come from order_lots and are
// computed, never typed (6.2 rule 2). Every value may be missing while the
// inspection is a draft.
import { z } from "zod";
import { CountCellSchema, TextCellSchema } from "@/modules/_framework";

export const LoadingDataSchema = z.strictObject({
  /** As painted on the container, e.g. "CSQU 305438 3"; checked against ISO 6346 when it looks like one. */
  containerNo: TextCellSchema,
  sealNo: TextCellSchema,
  /** Counts cartons, compared with the order's total cartons. */
  cartonsLoaded: CountCellSchema,
  cartonCondition: TextCellSchema,
});
export type LoadingData = z.infer<typeof LoadingDataSchema>;

export function emptyLoading(): LoadingData {
  return LoadingDataSchema.parse({});
}
