import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultConfig, defaultLabels, labelOverrides, moduleConfig, TEMPLATE_CODES, templateModuleKeys } from "@/lib/coverage";
import { resolveSeed } from "@/modules/sampling_plan/__fixtures__/seeds";
import { CARTON_SAMPLING_DEFAULT_CONFIG, CARTON_SAMPLING_LABELS, CARTON_SAMPLING_TITLE, CartonSamplingConfigSchema } from "./config";
import {
  CartonSamplingDataSchema,
  emptyCartonSampling,
  enteredCartons,
  MAX_CARTONS_PER_SIZE,
  withCartonNumber,
} from "./schema";

describe("carton_sampling data", () => {
  it("starts empty and keeps a draft grid with its blank cells in place", () => {
    expect(emptyCartonSampling()).toEqual({ sizes: {} });
    expect(CartonSamplingDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { cartonNumbers: [] } } });
    const draft = CartonSamplingDataSchema.parse({ sizes: { M: { cartonNumbers: [2834, null, 299] } } });
    expect(draft.sizes.M.cartonNumbers).toEqual([2834, null, 299]);
    expect(enteredCartons(draft.sizes.M)).toEqual([2834, 299]);
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

  it("sets one grid cell: blanks before it keep the numbers' places, blanks at the end are dropped", () => {
    const third = withCartonNumber(emptyCartonSampling(), "M", 2, 578);
    expect(third.sizes.M.cartonNumbers).toEqual([null, null, 578]);
    const first = withCartonNumber(third, "M", 0, 32);
    expect(first.sizes.M.cartonNumbers).toEqual([32, null, 578]);
    expect(withCartonNumber(first, "M", 2, null).sizes.M.cartonNumbers).toEqual([32]);
    expect(withCartonNumber(first, "M", 0, null).sizes.M.cartonNumbers).toEqual([null, null, 578]);
    expect(CartonSamplingDataSchema.parse(first)).toEqual(first);
    // The earlier data is left as it was.
    expect(third.sizes.M.cartonNumbers).toEqual([null, null, 578]);
  });

  it("keeps every other size when a cell changes, one no longer ordered included (6.2 rule 4)", () => {
    const saved = withCartonNumber(emptyCartonSampling(), "XS", 0, 7);
    const next = withCartonNumber(saved, "M", 0, 32);
    expect(next.sizes).toEqual({ XS: { cartonNumbers: [7] }, M: { cartonNumbers: [32] } });
    // Nothing to change: the same data, so the screen saves nothing.
    expect(withCartonNumber(next, "M", 0, 32)).toBe(next);
    expect(withCartonNumber(next, "M", 5, null)).toBe(next);
    expect(withCartonNumber(next, "L", 0, null)).toBe(next);
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
    expect(CARTON_SAMPLING_TITLE).toBe("Finished Goods Sampling Information (carton number)");
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
