import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defaultConfig,
  defaultLabels,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { mergeConfig, type JsonObject } from "@/lib/templates";
import { WEIGHT_DEFAULT_CONFIG, WEIGHT_LABELS, WEIGHT_TITLE, WeightConfigSchema } from "./config";
import { emptyWeight, WeightDataSchema } from "./schema";

/** The templates that switch weight on. */
const WITH_WEIGHT = TEMPLATE_CODES.filter((code) => moduleConfig(code, "weight") !== undefined);

/** The config a template resolves to: the module defaults, then each seed down the extends chain. */
function resolvedConfig(code: TemplateCode): unknown {
  const chain: TemplateCode[] = [];
  for (let current: TemplateCode | null = code; current !== null; current = TEMPLATES[current].extends) {
    chain.unshift(current);
  }
  return chain.reduce<JsonObject>(
    (config, template) => mergeConfig(config, (seedConfig(template, "weight") ?? {}) as JsonObject),
    WEIGHT_DEFAULT_CONFIG as unknown as JsonObject,
  );
}

describe("weight data", () => {
  it("starts empty and accepts a draft with values missing", () => {
    expect(emptyWeight()).toEqual({ sizes: {} });
    expect(WeightDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { values: [] } } });
    expect(WeightDataSchema.parse({ sizes: { M: { values: [2.9, null, 3.1] } } }).sizes.M.values).toEqual([2.9, null, 3.1]);
  });

  it("stores weights as numbers, never as text (6.2 rule 1)", () => {
    for (const text of ["2.9", "2 90", "2.9 g", ""]) {
      expect(WeightDataSchema.safeParse({ sizes: { M: { values: [text] } } }).success).toBe(false);
    }
  });

  it("keeps the average out of the data: it is computed (6.2 rule 2)", () => {
    expect(WeightDataSchema.safeParse({ sizes: { M: { values: [2.9], average: 2.9 } } }).success).toBe(false);
    expect(WeightDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });
});

describe("weight config", () => {
  it("defaults to the dictionary's defaults: 13 gloves, no spec, a warning beyond 10%, 2 decimals", () => {
    expect(WeightConfigSchema.parse(WEIGHT_DEFAULT_CONFIG)).toEqual(WEIGHT_DEFAULT_CONFIG);
    expect(WEIGHT_DEFAULT_CONFIG).toEqual(defaultConfig("weight"));
  });

  it.each(WITH_WEIGHT)("accepts the %s template's config, and resolves it down the extends chain", (code) => {
    const config = moduleConfig(code, "weight");
    expect(WeightConfigSchema.parse(config)).toEqual(config);
    expect(WeightConfigSchema.parse(resolvedConfig(code))).toEqual(config);
  });

  it("covers both report templates: 13 gloves on STD_EG, one value with an NA spec on SAFEDON_EG", () => {
    expect(WITH_WEIGHT).toEqual(["STD_EG", "SAFEDON_EG"]);
    expect(moduleConfig("STD_EG", "weight")).toMatchObject({ n: 13, specs: [] });
    expect(moduleConfig("SAFEDON_EG", "weight")).toMatchObject({
      n: 1,
      specs: ["XS", "S", "M", "L"].map((size) => ({ size, spec: { kind: "na" } })),
    });
  });

  it("rejects an n, threshold or decimals that cannot be used", () => {
    const parse = (change: object) => WeightConfigSchema.safeParse({ ...WEIGHT_DEFAULT_CONFIG, ...change }).success;
    expect(parse({ n: 0 })).toBe(false);
    expect(parse({ n: 1.5 })).toBe(false);
    expect(parse({ n: 1 })).toBe(true);
    expect(parse({ warnThresholdPct: -1 })).toBe(false);
    expect(parse({ warnThresholdPct: 7.5 })).toBe(true);
    expect(parse({ decimals: 1.5 })).toBe(false);
    expect(parse({ decimals: 11 })).toBe(false);
  });

  it("takes one spec row per canonical size", () => {
    const parse = (specs: unknown) => WeightConfigSchema.safeParse({ ...WEIGHT_DEFAULT_CONFIG, specs }).success;
    const row = (size: string) => ({ size, spec: { kind: "range", min: 2.5, max: 3.5 } });
    expect(parse([row("M"), row("L")])).toBe(true);
    expect(parse([row("M"), row("M")])).toBe(false);
    expect(parse([row("medium")])).toBe(false);
    expect(parse([{ size: "M" }])).toBe(false);
    expect(parse([{ size: "M", spec: { kind: "min", min: 2 }, extra: 1 }])).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(WeightConfigSchema) as { properties: Record<string, { description?: string }> };
    for (const key of ["n", "specs", "warnThresholdPct", "decimals"]) {
      expect(schema.properties[key].description, key).toBeTruthy();
    }
  });
});

describe("weight wording", () => {
  it("has the dictionary's title and default labels (STD_EG's wording)", () => {
    expect(WEIGHT_TITLE).toBe(moduleTitle("STD_EG", "weight"));
    expect(WEIGHT_LABELS).toMatchObject(defaultLabels("weight"));
  });

  it.each(TEMPLATE_CODES)("has a label for every key %s rewords", (code) => {
    for (const key of Object.keys(labelOverrides(code, "weight"))) {
      expect(Object.keys(WEIGHT_LABELS)).toContain(key);
    }
  });

  it("reads SAFEDON_EG's wording: 'Weight (g)', 'A / Rej.' and 'A'", () => {
    expect(moduleTitle("SAFEDON_EG", "weight")).toBe("Weight (g)");
    expect(labelOverrides("SAFEDON_EG", "weight")).toEqual({ result: "A / Rej.", info: "A" });
  });
});
