import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { checkSpec, formatSpec, type Spec } from "@/lib/stats";
import { SpecSchema } from "./config-schemas";

describe("SpecSchema", () => {
  it("is lib/stats' Spec", () => {
    expectTypeOf<z.infer<typeof SpecSchema>>().toEqualTypeOf<Spec>();
  });

  it.each<[Spec, string]>([
    [{ kind: "min", min: 240 }, "≥ 240"],
    [{ kind: "max", max: 80 }, "≤ 80"],
    [{ kind: "range", min: 0.08, max: 0.12 }, "0.08 – 0.12"],
    [{ kind: "tolerance", nominal: 76, tolerance: 4 }, "76 ± 4"],
    [{ kind: "na" }, "NA"],
  ])("accepts %o, which checkSpec and formatSpec take", (spec, printed) => {
    const parsed = SpecSchema.parse(spec);
    expect(formatSpec(parsed)).toBe(printed);
    expect(["pass", "fail", "na"]).toContain(checkSpec(100, parsed));
  });

  it.each([
    ["a mix of two kinds", { kind: "tolerance", max: 80, nominal: 76, tolerance: 4 }],
    ["an unknown kind", { kind: "about", value: 76 }],
    ["no kind", { min: 240 }],
    ["text for a number", { kind: "min", min: "240" }],
    ["a range upside down", { kind: "range", min: 12, max: 8 }],
    ["a negative tolerance", { kind: "tolerance", nominal: 76, tolerance: -4 }],
  ])("rejects %s", (_name, spec) => {
    expect(SpecSchema.safeParse(spec).success).toBe(false);
  });

  it("becomes JSON Schema for the template editor", () => {
    expect(() => z.toJSONSchema(z.strictObject({ spec: SpecSchema.nullable() }))).not.toThrow();
  });
});
