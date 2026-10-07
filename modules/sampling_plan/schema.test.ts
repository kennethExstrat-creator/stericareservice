import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defaultConfig,
  defaultLabels,
  labelOverrides,
  mergeConfig,
  moduleConfig,
  SAMPLING_COLUMNS as DICTIONARY_COLUMNS,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  type ConfigObject,
  type TemplateCode,
} from "@/lib/coverage";
import { resolveSeed } from "./__fixtures__/seeds";
import {
  columnGroups,
  SAMPLING_COLUMNS,
  SAMPLING_PLAN_DEFAULT_CONFIG,
  SAMPLING_PLAN_LABELS,
  SamplingPlanConfigSchema,
  type SamplingPlanConfig,
} from "./config";
import { emptySamplingPlan, emptySamplingSize, SamplingPlanDataSchema, withCount } from "./schema";

const FILLED_M = {
  cases: 50,
  innerUnits: 50,
  gloves: 500,
  glovesWatertightVisual: 500,
  glovesDimensions: 13,
  glovesPhysical: 13,
  innerUnitsDispensing: 13,
  pouches: null,
  pouchesDyeLeak: null,
};

describe("sampling_plan data", () => {
  it("starts empty and accepts a draft with anything missing, per size", () => {
    expect(emptySamplingPlan()).toEqual({ sizes: {} });
    expect(emptySamplingSize()).toEqual(Object.fromEntries(SAMPLING_COLUMNS.map((column) => [column, null])));
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { cases: 50 } } })).toEqual({
      sizes: { M: { ...emptySamplingSize(), cases: 50 } },
    });
    expect(SamplingPlanDataSchema.parse({ sizes: { M: FILLED_M, "7.0": { pouches: 4 } } }).sizes).toEqual({
      M: FILLED_M,
      "7.0": { ...emptySamplingSize(), pouches: 4 },
    });
  });

  it("stores counts as whole numbers from 0, never as text or dates (6.2 rules 1 and 3)", () => {
    for (const bad of ["50", "5 0", "2025-01-01", 1.5, -1, Number.NaN]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { cases: bad } } }).success, String(bad)).toBe(false);
    }
    expect(SamplingPlanDataSchema.parse({ sizes: { M: { glovesWatertightVisual: 0 } } }).sizes.M.glovesWatertightVisual).toBe(0);
  });

  it("keeps computed values out of the data: code letters, plans and totals are calculated (6.2 rule 2)", () => {
    for (const key of ["codeLetter", "planSampleSize", "lotSizeGloves", "orderQty"]) {
      expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { [key]: 1 } } }).success, key).toBe(false);
    }
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, totals: { cases: 50 } }).success).toBe(false);
  });

  it("rejects keys it does not have, the context's names and the reserved comment included", () => {
    expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { watertightVisual: 500 } } }).success).toBe(false);
    expect(SamplingPlanDataSchema.safeParse({ sizes: { M: { case: 5 } } }).success).toBe(false);
    expect(SamplingPlanDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });

  it("sets one count of one size and keeps every other size, one no longer ordered included (6.2 rule 4)", () => {
    const saved = withCount(emptySamplingPlan(), "XS", "cases", 5);
    const next = withCount(saved, "M", "glovesWatertightVisual", 500);
    expect(next.sizes).toEqual({
      XS: { ...emptySamplingSize(), cases: 5 },
      M: { ...emptySamplingSize(), glovesWatertightVisual: 500 },
    });
    expect(saved.sizes).toEqual({ XS: { ...emptySamplingSize(), cases: 5 } });
    expect(SamplingPlanDataSchema.parse(next)).toEqual(next);
    // Nothing to change: the same data, so the screen saves nothing.
    expect(withCount(next, "M", "glovesWatertightVisual", 500)).toBe(next);
    expect(withCount(next, "L", "cases", null)).toBe(next);
    expect(withCount(next, "XS", "cases", null).sizes.XS.cases).toBeNull();
  });
});

describe("sampling_plan config", () => {
  it("uses the dictionary's columns, defaults and wording (docs/DATA_DICTIONARY.md)", () => {
    expect(SAMPLING_COLUMNS).toEqual(DICTIONARY_COLUMNS);
    expect(SAMPLING_PLAN_DEFAULT_CONFIG).toEqual(defaultConfig("sampling_plan"));
    expect({ ...SAMPLING_PLAN_LABELS }).toEqual(defaultLabels("sampling_plan"));
  });

  it("shows the examination columns with no inspection level by default", () => {
    expect(SamplingPlanConfigSchema.parse(SAMPLING_PLAN_DEFAULT_CONFIG)).toEqual({
      columns: {
        cases: true,
        innerUnits: true,
        gloves: true,
        glovesWatertightVisual: true,
        glovesDimensions: true,
        glovesPhysical: true,
        innerUnitsDispensing: true,
        pouches: false,
        pouchesDyeLeak: false,
      },
      inspectionLevel: null,
    });
  });

  it.each(TEMPLATE_CODES)("accepts %s's config, as written and merged down its extends chain", (code) => {
    const own = moduleConfig(code, "sampling_plan");
    expect(SamplingPlanConfigSchema.parse(own)).toEqual(own);
    expect(SamplingPlanConfigSchema.parse(resolvedConfig(code))).toEqual(own);
  });

  it("takes every label a seed template overrides", () => {
    for (const code of TEMPLATE_CODES) {
      for (const key of Object.keys(labelOverrides(code, "sampling_plan"))) {
        expect(Object.keys(SAMPLING_PLAN_LABELS), `${code} ${key}`).toContain(key);
      }
    }
    expect(labelOverrides("SAFEDON_EG", "sampling_plan")).toMatchObject({ glovesPhysical: "# Gloves for Tensile" });
  });

  it.each(TEMPLATE_CODES)("lets %s resolve against the app's modules", (code) => {
    const resolved = resolveSeed(code);
    const entry = resolved.modules.find((found) => found.key === "sampling_plan");
    expect(entry?.config).toEqual(moduleConfig(code, "sampling_plan"));
    expect(entry?.labels).toMatchObject(labelOverrides(code, "sampling_plan"));
  });

  it("rejects a mistyped or missing column and a level ISO 2859-1 does not have", () => {
    const columns = SAMPLING_PLAN_DEFAULT_CONFIG.columns;
    expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...columns, glove: true } }).success).toBe(
      false,
    );
    const withoutPouches = Object.fromEntries(Object.entries(columns).filter(([column]) => column !== "pouches"));
    expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: withoutPouches }).success).toBe(false);
    for (const level of ["IV", "i", "S-5", ""]) {
      expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: level }).success, level).toBe(
        false,
      );
    }
    for (const level of ["S-1", "S-4", "I", "II", "III", null]) {
      expect(SamplingPlanConfigSchema.safeParse({ ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: level }).success).toBe(true);
    }
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(SamplingPlanConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.columns.description).toContain("Columns shown");
    expect(schema.properties.inspectionLevel.description).toContain("ISO 2859-1 inspection level");
  });

  it("groups the columns as the forms print them: EG's Sampling Quantity, SG's with the watertight and visual gloves", () => {
    expect(columnGroups(config("STD_EG"))).toEqual({
      quantity: ["cases", "innerUnits", "gloves"],
      tests: ["glovesWatertightVisual", "glovesDimensions", "glovesPhysical", "innerUnitsDispensing"],
    });
    expect(columnGroups(config("STD_SG"))).toEqual({
      quantity: ["cases", "innerUnits", "pouches", "glovesWatertightVisual"],
      tests: ["glovesDimensions", "glovesPhysical", "pouchesDyeLeak"],
    });
  });
});

function config(code: TemplateCode): SamplingPlanConfig {
  return SamplingPlanConfigSchema.parse(moduleConfig(code, "sampling_plan"));
}

/** The module's defaults, then each seed from the root of the chain down, as lib/templates merges them. */
function resolvedConfig(code: TemplateCode): ConfigObject {
  const chain: TemplateCode[] = [];
  for (let at: TemplateCode | null = code; at !== null; at = TEMPLATES[at].extends) chain.unshift(at);
  return chain.reduce(
    (merged, at) => mergeConfig(merged, seedConfig(at, "sampling_plan") ?? {}),
    SAMPLING_PLAN_DEFAULT_CONFIG as ConfigObject,
  );
}
