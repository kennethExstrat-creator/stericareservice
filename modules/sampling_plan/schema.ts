// Sampling Plan (BUILD_SPEC 6.1 sampling_plan): per ordered size, what was
// sampled and how many gloves or inner units each test takes. Every value may
// be missing while the inspection is a draft. The plan's code letter and n
// are computed (6.2 rule 2), never stored here.
import { z } from "zod";
import { CountCellSchema, perSizeData } from "@/modules/_framework";

export const SamplingSizeSchema = z.strictObject({
  /** Cases sampled. carton_sampling lists exactly this many carton numbers (6.2 rule 6). */
  cases: CountCellSchema,
  /** Inner units sampled: inner boxes, plastic packs, dispenser boxes or pouches (packing_config's inner unit). */
  innerUnits: CountCellSchema,
  /** Gloves sampled. */
  gloves: CountCellSchema,
  /** n of watertight and visual (BUILD_SPEC 8), checked against the inspection level's plan (6.2 rule 8). */
  glovesWatertightVisual: CountCellSchema,
  /** The dimension rows. */
  glovesDimensions: CountCellSchema,
  /** Gloves for the physical test: force at break (EN 455) or tensile (ASTM D6319). */
  glovesPhysical: CountCellSchema,
  /** Inner units for the packaging and dispensing check: its box rows. */
  innerUnitsDispensing: CountCellSchema,
  /** Surgical: pouches sampled. */
  pouches: CountCellSchema,
  /** Surgical: pouches for the dye leak test. */
  pouchesDyeLeak: CountCellSchema,
});
export type SamplingSize = z.infer<typeof SamplingSizeSchema>;

export const SamplingPlanDataSchema = perSizeData(SamplingSizeSchema);
export type SamplingPlanData = z.infer<typeof SamplingPlanDataSchema>;

export function emptySamplingPlan(): SamplingPlanData {
  return SamplingPlanDataSchema.parse({});
}

/** One size's row with nothing entered. */
export function emptySamplingSize(): SamplingSize {
  return SamplingSizeSchema.parse({});
}

/**
 * `data` with one count of one size set. Every other size is kept, also one
 * no longer ordered, so its data returns if the size is ordered again (6.2
 * rule 4). The same `data` when nothing changes.
 */
export function withCount(
  data: SamplingPlanData,
  size: string,
  column: keyof SamplingSize,
  value: number | null,
): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  if (row[column] === value) return data;
  return { ...data, sizes: { ...data.sizes, [size]: { ...row, [column]: value } } };
}
