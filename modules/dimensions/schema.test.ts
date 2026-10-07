import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defaultConfig,
  defaultLabels,
  labelOverrides,
  MEASURES as DICTIONARY_MEASURES,
  moduleConfig,
  moduleTitle,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { mergeConfig, type JsonObject } from "@/lib/templates";
import { readDecimalCell } from "@/modules/_framework";
import { SAFEDON_EG_EXPECTED } from "@/tests/fixtures/examples";
import {
  DIMENSIONS_DEFAULT_CONFIG,
  DIMENSIONS_LABELS,
  DIMENSIONS_TITLE,
  DimensionsConfigSchema,
  MEASURES,
} from "./config";
import { DimensionsDataSchema, emptyDimensions, emptyGlove } from "./schema";

const GLOVE = { length: 245, width: 95, fingerThickness: 0.09, palmThickness: 0.05, cuffThickness: 0.04 };

/** The templates that switch dimensions on, root first, so a child merges over its base. */
const WITH_DIMENSIONS = TEMPLATE_CODES.filter((code) => moduleConfig(code, "dimensions") !== undefined);

/** The config a template resolves to: the module defaults, then each seed down the extends chain. */
function resolvedConfig(code: TemplateCode): unknown {
  const chain: TemplateCode[] = [];
  for (let current: TemplateCode | null = code; current !== null; current = TEMPLATES[current].extends) {
    chain.unshift(current);
  }
  return chain.reduce<JsonObject>(
    (config, template) => mergeConfig(config, (seedConfig(template, "dimensions") ?? {}) as JsonObject),
    DIMENSIONS_DEFAULT_CONFIG as unknown as JsonObject,
  );
}

describe("dimensions data", () => {
  it("starts empty and accepts a draft with readings missing", () => {
    expect(emptyDimensions()).toEqual({ sizes: {} });
    expect(emptyGlove()).toEqual({
      length: null,
      width: null,
      fingerThickness: null,
      palmThickness: null,
      cuffThickness: null,
    });
    expect(DimensionsDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { gloves: [] } } });
    expect(DimensionsDataSchema.parse({ sizes: { M: { gloves: [{ length: 245 }, {}] } } })).toEqual({
      sizes: { M: { gloves: [{ ...emptyGlove(), length: 245 }, emptyGlove()] } },
    });
  });

  it("stores readings as numbers, never as text (6.2 rule 1)", () => {
    expect(DimensionsDataSchema.parse({ sizes: { M: { gloves: [GLOVE] } } }).sizes.M.gloves[0]).toEqual(GLOVE);
    for (const text of ["245", "2 42", "0 .18", "245 mm", ""]) {
      expect(DimensionsDataSchema.safeParse({ sizes: { M: { gloves: [{ length: text }] } } }).success).toBe(false);
    }
  });

  it("refuses the five cells the SAFEDON_EG inspector typed with a space, and takes the corrected numbers", () => {
    expect(SAFEDON_EG_EXPECTED.rejectedInputs).toHaveLength(5);
    for (const input of SAFEDON_EG_EXPECTED.rejectedInputs) {
      expect(readDecimalCell(input.raw)).toEqual({
        ok: false,
        error: `One number per cell: remove the space (“${input.raw}” → ${input.accepted}).`,
      });
      expect(readDecimalCell(String(input.accepted))).toEqual({ ok: true, value: input.accepted });
    }
  });

  it("rejects keys it does not have, the reserved comment included", () => {
    expect(DimensionsDataSchema.safeParse({ sizes: { M: { gloves: [{ lenght: 245 }] } } }).success).toBe(false);
    expect(DimensionsDataSchema.safeParse({ sizes: { M: { gloves: [], median: 245 } } }).success).toBe(false);
    expect(DimensionsDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });
});

describe("dimensions config", () => {
  it("defaults to the dictionary's defaults: every measure, the median, the reports' decimals, 13 gloves", () => {
    expect(DimensionsConfigSchema.parse(DIMENSIONS_DEFAULT_CONFIG)).toEqual(DIMENSIONS_DEFAULT_CONFIG);
    expect(DIMENSIONS_DEFAULT_CONFIG).toEqual(defaultConfig("dimensions"));
    expect(MEASURES).toEqual(DICTIONARY_MEASURES);
  });

  it.each(WITH_DIMENSIONS)("accepts the %s template's config, and resolves it down the extends chain", (code) => {
    const config = moduleConfig(code, "dimensions");
    expect(DimensionsConfigSchema.parse(config)).toEqual(config);
    expect(DimensionsConfigSchema.parse(resolvedConfig(code))).toEqual(config);
  });

  it("covers the three seed templates", () => {
    expect(WITH_DIMENSIONS).toEqual(["STD_EG", "SAFEDON_EG", "STD_SG"]);
    expect(moduleConfig("SAFEDON_EG", "dimensions")).toMatchObject({
      measures: ["length", "width", "fingerThickness", "palmThickness"],
      statistic: "average",
    });
  });

  it("rejects measures it does not know, twice or not at all", () => {
    const parse = (measures: unknown) => DimensionsConfigSchema.safeParse({ ...DIMENSIONS_DEFAULT_CONFIG, measures }).success;
    expect(parse(["length", "weight"])).toBe(false);
    expect(parse(["length", "length"])).toBe(false);
    expect(parse([])).toBe(false);
    expect(parse(["width", "length"])).toBe(true);
  });

  it("takes one spec row per canonical size, each spec a lib/stats Spec", () => {
    const parse = (specs: unknown) => DimensionsConfigSchema.safeParse({ ...DIMENSIONS_DEFAULT_CONFIG, specs }).success;
    const row = (size: string) => ({ size, specs: { length: { kind: "min", min: 240 } } });
    expect(parse([row("M"), row("L")])).toBe(true);
    expect(parse([row("M"), row("M")])).toBe(false);
    expect(parse([row("m")])).toBe(false);
    expect(parse([{ size: "M", specs: { length: { kind: "min" } } }])).toBe(false);
    expect(parse([{ size: "M", specs: { weight: { kind: "na" } } }])).toBe(false);
    expect(parse([{ size: "M", specs: { width: { kind: "range", min: 90, max: 80 } } }])).toBe(false);
  });

  it("rejects decimals and row counts that cannot be printed or measured", () => {
    const decimals = (length: number) =>
      DimensionsConfigSchema.safeParse({
        ...DIMENSIONS_DEFAULT_CONFIG,
        decimals: { ...DIMENSIONS_DEFAULT_CONFIG.decimals, length },
      }).success;
    expect(decimals(1.5)).toBe(false);
    expect(decimals(-1)).toBe(false);
    expect(decimals(11)).toBe(false);
    const rows = (value: number) => DimensionsConfigSchema.safeParse({ ...DIMENSIONS_DEFAULT_CONFIG, rows: value }).success;
    expect(rows(0)).toBe(false);
    expect(rows(12.5)).toBe(false);
    expect(rows(1)).toBe(true);
    const missing = Object.fromEntries(
      Object.entries(DIMENSIONS_DEFAULT_CONFIG.decimals).filter(([measure]) => measure !== "cuffThickness"),
    );
    expect(DimensionsConfigSchema.safeParse({ ...DIMENSIONS_DEFAULT_CONFIG, decimals: missing }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(DimensionsConfigSchema) as { properties: Record<string, { description?: string }> };
    for (const key of ["measures", "statistic", "specs", "decimals", "rows"]) {
      expect(schema.properties[key].description, key).toBeTruthy();
    }
  });
});

describe("dimensions wording", () => {
  it("has the dictionary's title and default labels (STD_EG's wording)", () => {
    expect(DIMENSIONS_TITLE).toBe(moduleTitle("STD_EG", "dimensions"));
    expect(DIMENSIONS_LABELS).toEqual(defaultLabels("dimensions"));
  });

  it.each(TEMPLATE_CODES)("has a label for every key %s rewords", (code) => {
    for (const key of Object.keys(labelOverrides(code, "dimensions"))) {
      expect(Object.keys(DIMENSIONS_LABELS)).toContain(key);
    }
  });

  it("reads SAFEDON_EG's wording for the statistic and the result words", () => {
    expect(labelOverrides("SAFEDON_EG", "dimensions")).toEqual({
      statistic: "Average",
      measureResult: "A / Rej.",
      pass: "A",
      fail: "Rej.",
    });
  });
});
