// Defaults a template can override: the heading and the labels (STD_EG's
// wording, with "Box/Carton #" for the number: Kenneth, 13 October 2026, box #
// and carton # are one number). The module has no settings (BUILD_SPEC 6.1
// carton_sampling: config none); the rules of 6.2 rule 6 are the same in
// every template.
import { z } from "zod";

export const CARTON_SAMPLING_TITLE = "Finished Goods Sampling Information (Box/Carton #)";

export const CARTON_SAMPLING_LABELS = {
  cartonNumbers: "(Box/Carton #)",
  samplingQuantity: "Sampling Quantity",
  /** Caption of each size's table; the screen fills in {size}. */
  sizeCaption: "{size} (Box/Carton #)",
} as const satisfies Readonly<Record<string, string>>;

/**
 * The report's grid: 10 box/carton numbers to a row (5 rows print 50). The
 * capture screen has a table instead, one carton a row, and calc's issue
 * messages name a carton by its row's No. there.
 */
export const GRID_COLUMNS = 10;

export const CartonSamplingConfigSchema = z
  .strictObject({})
  .describe("No settings: box/carton numbers are checked the same way in every template (BUILD_SPEC 6.2 rule 6).");
export type CartonSamplingConfig = z.infer<typeof CartonSamplingConfigSchema>;

export const CARTON_SAMPLING_DEFAULT_CONFIG: CartonSamplingConfig = {};
