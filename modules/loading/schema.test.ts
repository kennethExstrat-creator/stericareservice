import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataKeys, defaultConfig, defaultLabels, LOADING_FIELDS as DICTIONARY_FIELDS, moduleTitle, TEMPLATES } from "@/lib/coverage";
import { SAFEDON_EG_EXAMPLE, SAFEDON_EG_EXPECTED } from "@/tests/fixtures/examples";
import { LOADING_DEFAULT_CONFIG, LOADING_FIELDS, LOADING_LABELS, LOADING_STAGES, LOADING_TITLE, LoadingConfigSchema } from "./config";
import { emptyLoading, LoadingDataSchema } from "./schema";

describe("loading data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyLoading()).toEqual({ containerNo: null, sealNo: null, cartonsLoaded: null, cartonCondition: null });
    expect(LoadingDataSchema.parse({ sealNo: "SL-0001" })).toEqual({ ...emptyLoading(), sealNo: "SL-0001" });
  });

  it("holds the dictionary's entered keys and nothing else", () => {
    expect(Object.keys(LoadingDataSchema.shape)).toEqual(dataKeys("loading", "entered"));
    expect([...LOADING_FIELDS]).toEqual([...DICTIONARY_FIELDS]);
  });

  it("stores the cartons loaded as a whole number, never as text or a date (6.2 rules 1 and 3)", () => {
    const cartons = (value: unknown) => LoadingDataSchema.safeParse({ cartonsLoaded: value }).success;
    expect(cartons(1530)).toBe(true);
    expect(cartons(0)).toBe(true);
    const asDate = SAFEDON_EG_EXAMPLE.watertight.perSize.XS?.printedTotal;
    const typedWithSpace = SAFEDON_EG_EXPECTED.rejectedInputs.find((input) => input.raw === "2 42")?.raw;
    for (const value of [asDate, typedWithSpace, "1,530", "1530", 1529.5, -1]) expect(cartons(value)).toBe(false);
  });

  it("rejects fields it does not have: the cartons ordered are computed, and the comment is reserved", () => {
    expect(LoadingDataSchema.safeParse({ cartonsOrdered: 1530 }).success).toBe(false);
    expect(LoadingDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(LoadingDataSchema.safeParse({ containerNumber: "CSQU3054383" }).success).toBe(false);
  });
});

describe("loading config", () => {
  it("shows every field by default", () => {
    expect(LoadingConfigSchema.parse(LOADING_DEFAULT_CONFIG)).toEqual(LOADING_DEFAULT_CONFIG);
    expect(LOADING_DEFAULT_CONFIG).toEqual(defaultConfig("loading"));
  });

  it("accepts every template's values in lib/coverage (no seed template includes the module yet)", () => {
    const configs = Object.values(TEMPLATES).flatMap((template) =>
      template.modules.flatMap((entry) => (entry.key === "loading" ? [entry.config] : [])),
    );
    for (const config of [defaultConfig("loading"), ...configs]) {
      expect(LoadingConfigSchema.safeParse(config).success).toBe(true);
    }
  });

  it("rejects a mistyped or missing field switch", () => {
    const typo = { fields: { ...LOADING_DEFAULT_CONFIG.fields, sealNumber: false } };
    expect(LoadingConfigSchema.safeParse(typo).success).toBe(false);
    const withoutSeal = Object.fromEntries(Object.entries(LOADING_DEFAULT_CONFIG.fields).filter(([key]) => key !== "sealNo"));
    expect(LoadingConfigSchema.safeParse({ fields: withoutSeal }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(LoadingConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.fields.description).toBe("Fields shown on this template");
  });
});

describe("loading wording", () => {
  it("defaults to the data dictionary's title and labels, with a caption per loading stage", () => {
    expect(LOADING_TITLE).toBe(moduleTitle("STD_EG", "loading"));
    expect(LOADING_LABELS).toMatchObject(defaultLabels("loading"));
    for (const stage of LOADING_STAGES) expect(LOADING_LABELS[stage]).toBeTruthy();
  });
});
