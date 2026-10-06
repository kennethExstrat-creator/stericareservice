// Config building blocks shared by modules, so every template stores a spec
// the same way and the extends merge (lib/templates/merge.ts) treats it as
// one value.
import { z } from "zod";

/**
 * A specification limit as the reports print it, the lib/stats Spec that
 * `checkSpec` and `formatSpec` take: ≥ 240, ≤ 80, a range, 95 ± 10 or NA.
 * Tagged by `kind`, so a child template that sets a spec replaces it whole.
 */
export const SpecSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("min"), min: z.number() }),
    z.strictObject({ kind: z.literal("max"), max: z.number() }),
    z
      .strictObject({ kind: z.literal("range"), min: z.number(), max: z.number() })
      .refine((spec) => spec.min <= spec.max, { error: "max must not be below min.", path: ["max"] }),
    z.strictObject({ kind: z.literal("tolerance"), nominal: z.number(), tolerance: z.number().min(0) }),
    z.strictObject({ kind: z.literal("na") }),
  ])
  .describe("Specification: minimum, maximum, range, nominal ± tolerance, or NA");
