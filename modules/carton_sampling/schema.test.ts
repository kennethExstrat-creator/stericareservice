import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultConfig, defaultLabels, labelOverrides, moduleConfig, TEMPLATE_CODES, templateModuleKeys } from "@/lib/coverage";
import { resolveSeed } from "@/modules/sampling_plan/__fixtures__/seeds";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS, CARTON_SAMPLING_TITLE, CartonSamplingConfigSchema } from "./config";
import { CartonSamplingDataSchema, emptyCartonSampling, enteredCartons, MAX_CARTONS_PER_SIZE } from "./schema";

describe("carton_sampling data", () => {
  it("starts empty and still reads a list saved from the earlier grid, its blank cells included", () => {
    expect(emptyCartonSampling()).toEqual({ sizes: {} });
    expect(CartonSamplingDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { cartonNumbers: [] } } });
    const saved = CartonSamplingDataSchema.parse({ sizes: { M: { cartonNumbers: [2834, null, 299] } } });
    expect(saved.sizes.M.cartonNumbers).toEqual([2834, null, 299]);
    // The blanks are no cartons: the list, calc and the box pickers see the numbers only.
    expect(enteredCartons(saved.sizes.M)).toEqual([2834, 299]);
    expect(enteredCartons(undefined)).toEqual([]);
  });

  it("stores carton numbers as whole numbers from 1, never as text or dates (6.2 rules 1, 3 and 6)", () => {
    for (const bad of ["525", "5 25", "2025-01-01", 52.5, 0, -1]) {
      expect(CartonSamplingDataSchema.safeParse({ sizes: { M: { cartonNumbers: [bad] } } }).success, String(bad)).toBe(false);
    }
  });

  it("keeps duplicates, which calc reports, and no more cartons per size than any plan samples", () => {
    expect(CartonSamplingDataSchema.parse({ sizes: { M: { cartonNumbers: [525, 525] } } }).sizes.M.cartonNumbers).toEqual([525, 525]);
    const many = Array.from({ length: MAX_CARTONS_PER_SIZE + 1 }, (_, index) => index + 1);
    expect(CartonSamplingDataSchema.safeParse({ sizes: { M: { cartonNumbers: many } } }).success).toBe(false);
  });

  it("keeps the count out of the data: it is computed (6.2 rule 2); rejects unknown keys and the reserved comment", () => {
    expect(CartonSamplingDataSchema.safeParse({ sizes: { M: { cartonNumbers: [], samplingQuantity: 50 } } }).success).toBe(false);
    expect(CartonSamplingDataSchema.safeParse({ sizes: { M: [32, 578] } }).success).toBe(false);
    expect(CartonSamplingDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });
});

describe("carton_sampling config", () => {
  it("has no settings, as the dictionary says, and the reports' wording", () => {
    expect(CARTON_SAMPLING_DEFAULT_CONFIG).toEqual(defaultConfig("carton_sampling"));
    expect(CartonSamplingConfigSchema.parse(CARTON_SAMPLING_DEFAULT_CONFIG)).toEqual({});
    expect(CartonSamplingConfigSchema.safeParse({ gridColumns: 10 }).success).toBe(false);
    expect(CARTON_SAMPLING_TITLE).toBe("Finished Goods Sampling Information (Carton Number)");
    expect(CARTON_SAMPLING_LABELS).toEqual(defaultLabels("carton_sampling"));
  });

  it("accepts every seed template's config and resolves in each template that has it", () => {
    const codes = TEMPLATE_CODES.filter((code) => templateModuleKeys(code).includes("carton_sampling"));
    expect(codes).toEqual(["STD_EG", "SAFEDON_EG"]);
    for (const code of codes) {
      expect(CartonSamplingConfigSchema.parse(moduleConfig(code, "carton_sampling"))).toEqual({});
      expect(labelOverrides(code, "carton_sampling")).toEqual({});
      const entry = resolveSeed(code).modules.find((found) => found.key === "carton_sampling");
      expect(entry).toMatchObject({ include: true, title: CARTON_SAMPLING_TITLE, config: {} });
    }
  });

  it("becomes JSON Schema, for the template editor", () => {
    const schema = z.toJSONSchema(CartonSamplingConfigSchema) as { description?: string; additionalProperties?: boolean };
    expect(schema.description).toContain("No settings");
    expect(schema.additionalProperties).toBe(false);
  });
});
