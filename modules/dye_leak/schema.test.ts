import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataKeys, defaultConfig, defaultLabels, moduleConfig, moduleTitle, seedConfig, TEMPLATES } from "@/lib/coverage";
import { SAFEDON_EG_EXAMPLE, SAFEDON_EG_EXPECTED } from "@/tests/fixtures/examples";
import { DYE_LEAK_DEFAULT_CONFIG, DYE_LEAK_FIELDS, DYE_LEAK_LABELS, DYE_LEAK_TITLE, DyeLeakConfigSchema } from "./config";
import { DyeLeakDataSchema, DyeLeakSizeSchema, emptyDyeLeak, emptyDyeLeakSize } from "./schema";

describe("dye_leak data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyDyeLeak()).toEqual({ sizes: {} });
    expect(emptyDyeLeakSize()).toEqual({ pouchesTested: null, pouchesFailed: null, notes: null });
    expect(DyeLeakDataSchema.parse({ sizes: { "7.0": { pouchesTested: 13 } } })).toEqual({
      sizes: { "7.0": { pouchesTested: 13, pouchesFailed: null, notes: null } },
    });
  });

  it("holds the dictionary's entered keys and nothing else", () => {
    expect(Object.keys(DyeLeakSizeSchema.shape)).toEqual(dataKeys("dye_leak", "entered"));
    expect([...DYE_LEAK_FIELDS]).toEqual(dataKeys("dye_leak", "entered"));
  });

  it("stores counts as whole numbers from 0, never as text or a date (6.2 rules 1 and 3)", () => {
    const count = (value: unknown) => DyeLeakSizeSchema.safeParse({ pouchesFailed: value }).success;
    expect(count(0)).toBe(true);
    expect(count(2)).toBe(true);
    // The SAFEDON_EG report stored a count as the date 1 January 1980, and a
    // dimension cell as "2 42": neither gets into a count.
    const asDate = SAFEDON_EG_EXAMPLE.watertight.perSize.XS?.printedTotal;
    expect(asDate).toBe("Jan-80");
    const typedWithSpace = SAFEDON_EG_EXPECTED.rejectedInputs.find((input) => input.raw === "2 42")?.raw;
    for (const value of [asDate, typedWithSpace, "1/80", "13", "1980-01-01", 1.5, -1, Number.NaN]) {
      expect(count(value)).toBe(false);
    }
  });

  it("rejects fields it does not have, the reserved comment included", () => {
    expect(DyeLeakDataSchema.safeParse({ sizes: { "7.0": { pouchesLeaked: 1 } } }).success).toBe(false);
    expect(DyeLeakDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
    expect(DyeLeakDataSchema.safeParse({ sizes: {}, total: 3 }).success).toBe(false);
  });
});

describe("dye_leak config", () => {
  it("takes n from the sampling plan by default", () => {
    expect(DyeLeakConfigSchema.parse(DYE_LEAK_DEFAULT_CONFIG)).toEqual({ n: null });
    expect(DYE_LEAK_DEFAULT_CONFIG).toEqual(defaultConfig("dye_leak"));
  });

  it("accepts every template's values in lib/coverage", () => {
    const templates = Object.values(TEMPLATES).filter((template) =>
      template.modules.some((entry) => entry.key === "dye_leak"),
    );
    expect(templates.map((template) => template.code)).toEqual(["STD_SG"]);
    for (const template of templates) {
      expect(DyeLeakConfigSchema.safeParse(moduleConfig(template.code, "dye_leak")).success).toBe(true);
      expect(DyeLeakConfigSchema.safeParse(seedConfig(template.code, "dye_leak")).success).toBe(true);
    }
  });

  it("takes a positive whole number of pouches or nothing", () => {
    expect(DyeLeakConfigSchema.parse({ n: 13 })).toEqual({ n: 13 });
    for (const n of [0, -1, 1.5, "13"]) expect(DyeLeakConfigSchema.safeParse({ n }).success).toBe(false);
    expect(DyeLeakConfigSchema.safeParse({ n: 13, perSize: 13 }).success).toBe(false);
  });

  it("becomes JSON Schema with a description, for the template editor's form", () => {
    const schema = z.toJSONSchema(DyeLeakConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.n.description).toContain("sampling plan");
  });
});

describe("dye_leak wording", () => {
  it("defaults to the data dictionary's title and labels", () => {
    expect(DYE_LEAK_TITLE).toBe(moduleTitle("STD_SG", "dye_leak"));
    expect(DYE_LEAK_LABELS).toEqual(defaultLabels("dye_leak"));
  });
});
