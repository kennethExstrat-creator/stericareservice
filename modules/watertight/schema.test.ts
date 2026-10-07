import { describe, expect, it } from "vitest";
import { z } from "zod";
import { moduleConfig, TEMPLATE_CODES } from "@/lib/coverage";
import { WATERTIGHT_DEFAULT_CONFIG, WatertightConfigSchema } from "./config";
import { emptyWatertight, emptyWatertightSize, WatertightDataSchema, WatertightSizeSchema } from "./schema";

describe("watertight data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyWatertight()).toEqual({ sizes: {} });
    expect(emptyWatertightSize()).toEqual({ holes: {}, otherDescription: null, unmapped: [], tested: null });
    expect(WatertightDataSchema.parse({ sizes: { M: { holes: { hole_finger: 1 } } } })).toEqual({
      sizes: { M: { tested: null, holes: { hole_finger: 1 }, otherDescription: null, unmapped: [] } },
    });
  });

  it("keeps holes per hand under R and L, the gloves tested on the size", () => {
    const parsed = WatertightSizeSchema.parse({ tested: 125, R: { holes: { hole_palm: 1 } }, L: {} });
    expect(parsed).toEqual({
      tested: 125,
      holes: {},
      otherDescription: null,
      unmapped: [],
      R: { holes: { hole_palm: 1 }, otherDescription: null, unmapped: [] },
      L: { holes: {}, otherDescription: null, unmapped: [] },
    });
  });

  it("stores counts as whole numbers, never as text or a date (6.2 rules 1 and 3)", () => {
    // SAFEDON_EG XS: "1/80" typed into the total cell came back as 1 January 1980.
    for (const text of ["1/80", "Jan-80", "1980-01-01", "2 42", "1"]) {
      expect(WatertightSizeSchema.safeParse({ tested: text }).success).toBe(false);
      expect(WatertightSizeSchema.safeParse({ holes: { hole_finger: text } }).success).toBe(false);
    }
    for (const count of [-1, 1.5, Number.NaN]) {
      expect(WatertightSizeSchema.safeParse({ tested: count }).success).toBe(false);
      expect(WatertightSizeSchema.safeParse({ holes: { hole_finger: count } }).success).toBe(false);
      expect(WatertightSizeSchema.safeParse({ unmapped: [{ label: "Thumb", count }] }).success).toBe(false);
    }
  });

  it("never stores what is computed: totals, limits, code letters and results are not data (6.2 rule 2)", () => {
    for (const key of ["totalDefects", "accept", "reject", "codeLetter", "result"]) {
      expect(WatertightSizeSchema.safeParse({ tested: 500, [key]: 1 }).success).toBe(false);
    }
  });

  it("keys holes by defect code and rejects keys it does not have, the reserved comment included", () => {
    expect(WatertightSizeSchema.safeParse({ holes: { "Between fingers": 1 } }).success).toBe(false);
    expect(WatertightSizeSchema.safeParse({ testd: 500 }).success).toBe(false);
    expect(WatertightDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });

  it("keeps a one-off defect with its own words, which must not be blank", () => {
    expect(WatertightSizeSchema.parse({ unmapped: [{ label: "Near the thumb", count: 2 }] }).unmapped).toEqual([
      { label: "Near the thumb", count: 2 },
    ]);
    expect(WatertightSizeSchema.safeParse({ unmapped: [{ label: "  ", count: 1 }] }).success).toBe(false);
  });
});

describe("watertight config", () => {
  it("defaults to STD_EG's locations, no hand split, and the context's AQL", () => {
    expect(WatertightConfigSchema.parse(WATERTIGHT_DEFAULT_CONFIG)).toEqual({
      aql: null,
      locations: [
        { code: "hole_crotch", label: "Between Fingers (Crotch)" },
        { code: "hole_palm", label: "Palm" },
        { code: "hole_finger", label: "Finger" },
        { code: "hole_cuff", label: "Cuff" },
        { code: "hole_other", label: "Other :" },
      ],
      handSplit: false,
    });
  });

  it.each(TEMPLATE_CODES)("accepts the %s template's values (lib/coverage)", (code) => {
    const config = moduleConfig(code, "watertight");
    expect(config).toBeDefined();
    expect(WatertightConfigSchema.parse(config)).toEqual(config);
  });

  it("takes only ISO 2859-1 AQLs, and a location code once", () => {
    for (const aql of [0, 0.65, 1.5, 2.5, null]) {
      expect(WatertightConfigSchema.safeParse({ ...WATERTIGHT_DEFAULT_CONFIG, aql }).success).toBe(true);
    }
    for (const aql of [1.2, -1, "1.5"]) {
      expect(WatertightConfigSchema.safeParse({ ...WATERTIGHT_DEFAULT_CONFIG, aql }).success).toBe(false);
    }
    const twice = [...WATERTIGHT_DEFAULT_CONFIG.locations, { code: "hole_palm", label: "Palm again" }];
    expect(WatertightConfigSchema.safeParse({ ...WATERTIGHT_DEFAULT_CONFIG, locations: twice }).success).toBe(false);
    const notACode = [{ code: "Glove burst", label: "Glove burst" }];
    expect(WatertightConfigSchema.safeParse({ ...WATERTIGHT_DEFAULT_CONFIG, locations: notACode }).success).toBe(false);
    expect(WatertightConfigSchema.safeParse({ ...WATERTIGHT_DEFAULT_CONFIG, handsplit: true }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(WatertightConfigSchema) as {
      properties: Record<string, { description?: string; anyOf?: { enum?: number[] }[] }>;
    };
    expect(schema.properties.aql.description).toContain("AQL");
    expect(schema.properties.aql.anyOf?.[0].enum).toContain(1.5);
    expect(schema.properties.locations.description).toContain("Hole locations");
    expect(schema.properties.handSplit.description).toContain("right and left");
  });
});
