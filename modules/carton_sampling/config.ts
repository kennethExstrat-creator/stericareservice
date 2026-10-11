// Defaults a template can override: the heading and the labels (STD_EG's
// wording). The module has no settings (BUILD_SPEC 6.1 carton_sampling:
// config none); the rules of 6.2 rule 6 are the same in every template.
import { z } from "zod";

export const CARTON_SAMPLING_TITLE = "Finished Goods Sampling Information (Carton Number)";

export const CARTON_SAMPLING_LABELS = {
  cartonNumbers: "(Carton #)",
  samplingQuantity: "Sampling Quantity",
  /** Caption of each size's list; the screen fills in {size}. */
  sizeCaption: "{size} (Carton #)",
} as const satisfies Readonly<Record<string, string>>;

/**
 * The report's grid: 10 carton numbers to a row (5 rows print 50). The
 * capture screen lists them; calc's issue messages name each number by its
 * row and column on the report.
 */
export const GRID_COLUMNS = 10;

export const CartonSamplingConfigSchema = z
  .strictObject({})
  .describe("No settings: carton numbers are checked the same way in every template (BUILD_SPEC 6.2 rule 6).");
export type CartonSamplingConfig = z.infer<typeof CartonSamplingConfigSchema>;

export const CARTON_SAMPLING_DEFAULT_CONFIG: CartonSamplingConfig = {};
