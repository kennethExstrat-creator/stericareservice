// Dye leak test (BUILD_SPEC 6.1 dye_leak, sterile surgical gloves): per
// ordered size, the pouches tested, how many leaked and notes. The SG onsite
// form plans the pouches ('# pouches (dye leak test)') but has nowhere to
// record the results. Every value may be missing while the inspection is a
// draft; counts are whole numbers, never text or dates (6.2 rules 1 and 3).
import { z } from "zod";
import { CountCellSchema, perSizeData, TextCellSchema } from "@/modules/_framework";

export const DyeLeakSizeSchema = z.strictObject({
  /** Counts pouches. Prefilled on screen from the plan (sampling plan, else config n). */
  pouchesTested: CountCellSchema,
  /** Counts pouches that let the dye through. One is enough to fail the size. */
  pouchesFailed: CountCellSchema,
  /** Where a pouch leaked, as the inspector saw it. */
  notes: TextCellSchema,
});
export type DyeLeakSize = z.infer<typeof DyeLeakSizeSchema>;

export const DyeLeakDataSchema = perSizeData(DyeLeakSizeSchema);
export type DyeLeakData = z.infer<typeof DyeLeakDataSchema>;

export function emptyDyeLeak(): DyeLeakData {
  return DyeLeakDataSchema.parse({});
}

export function emptyDyeLeakSize(): DyeLeakSize {
  return DyeLeakSizeSchema.parse({});
}
