// Defaults a template can override: the heading, the labels (the data
// dictionary's wording: no filled report has a dye leak table yet) and the
// config (BUILD_SPEC 6.1: n per size).
import { z } from "zod";

export const DYE_LEAK_TITLE = "Dye Leak Test";

/** What the inspector enters per size, in screen order. */
export const DYE_LEAK_FIELDS = ["pouchesTested", "pouchesFailed", "notes"] as const;
export type DyeLeakField = (typeof DYE_LEAK_FIELDS)[number];

/** The entered fields, the computed result line, the plan shown above the counts and the totals. */
export const DYE_LEAK_LABELS: Readonly<
  Record<DyeLeakField | "result" | "pouchesPlanned" | "totalTested" | "totalFailed", string>
> = {
  pouchesTested: "Pouches Tested",
  pouchesFailed: "Pouches Failed",
  notes: "Notes",
  pouchesPlanned: "Pouches Planned",
  result: "Passed / Failed",
  totalTested: "Total Pouches Tested",
  totalFailed: "Total Pouches Failed",
};

export const DyeLeakConfigSchema = z.strictObject({
  n: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      "Pouches to test per size when the sampling plan gives none. Empty: the sampling plan's '# Pouches (Dye Leak Test)' for each size.",
    ),
});
export type DyeLeakConfig = z.infer<typeof DyeLeakConfigSchema>;

export const DYE_LEAK_DEFAULT_CONFIG: DyeLeakConfig = { n: null };
