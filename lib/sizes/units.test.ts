import { describe, expect, it } from "vitest";
import { UnitSchema } from "@/lib/schemas/common";
import { MEASUREMENT_UNITS, normaliseUnit, UNITS } from "./units";

describe("units", () => {
  it("are the canonical units of BUILD_SPEC 4.2 rule 5, plus pcs for counts", () => {
    expect(MEASUREMENT_UNITS).toEqual(["mm", "g", "N", "MPa", "%"]);
    expect([...UNITS].sort()).toEqual([...UnitSchema.options].sort());
  });

  it.each([
    ["mm", "mm"],
    ["Millimetres", "mm"],
    ["G", "g"],
    ["grams", "g"],
    ["n", "N"],
    ["Newton", "N"],
    ["Mpa", "MPa"],
    ["N/mm²", "MPa"],
    ["N / mm2", "MPa"],
    [" % ", "%"],
    ["percent", "%"],
    ["Pieces", "pcs"],
  ])("reads %j as %j", (raw, unit) => {
    expect(normaliseUnit(raw)).toBe(unit);
  });

  it.each(["", "kg", "inch", "psi", "m"])("does not guess %j", (raw) => {
    expect(normaliseUnit(raw)).toBeNull();
  });
});
