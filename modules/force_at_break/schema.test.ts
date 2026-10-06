import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  moduleConfig,
  moduleTitle,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
} from "@/lib/coverage";
import { resolveTemplateOrThrow } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  FORCE_AT_BREAK_DEFAULT_CONFIG,
  FORCE_AT_BREAK_LABELS,
  FORCE_AT_BREAK_TITLE,
  ForceAtBreakConfigSchema,
} from "./config";
import { emptyForceAtBreak, emptyForceAtBreakSize, ForceAtBreakDataSchema } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";

describe("force_at_break data", () => {
  it("starts empty and accepts a draft with readings still missing", () => {
    expect(emptyForceAtBreak()).toEqual({ sizes: {}, labReport: null });
    expect(emptyForceAtBreakSize()).toEqual({ values: [] });
    expect(ForceAtBreakDataSchema.parse({ sizes: { M: { values: [6.47, null, 6.301] } } })).toEqual({
      sizes: { M: { values: [6.47, null, 6.301] } },
      labReport: null,
    });
    expect(ForceAtBreakDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { values: [] } }, labReport: null });
  });

  it("stores readings as numbers, never as text (6.2 rule 1)", () => {
    for (const text of ["6.47", "6 47", "6.47 N", ""]) {
      expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5, text] } } }).success).toBe(false);
    }
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [Number.POSITIVE_INFINITY] } } }).success).toBe(false);
  });

  it("keeps the median and the result out of the data (6.2 rule 2)", () => {
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5], median: 6.5 } } }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5], result: "pass" } } }).success).toBe(false);
  });

  it("refers to the lab report by its inspection_files id", () => {
    expect(ForceAtBreakDataSchema.parse({ labReport: LAB_REPORT_ID }).labReport).toBe(LAB_REPORT_ID);
    expect(ForceAtBreakDataSchema.safeParse({ labReport: "lab-report.pdf" }).success).toBe(false);
  });

  it("rejects fields it does not have, the reserved comment included", () => {
    expect(ForceAtBreakDataSchema.safeParse({ sizes: {}, forces: [] }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { readings: [6.5] } } }).success).toBe(false);
  });

  it("holds exactly the dictionary's entered keys (docs/DATA_DICTIONARY.md)", () => {
    const keys = [...Object.keys(emptyForceAtBreakSize()), ...Object.keys(emptyForceAtBreak()).filter((key) => key !== "sizes")];
    expect(keys.sort()).toEqual(dataKeys("force_at_break", "entered").sort());
  });
});

describe("force_at_break config", () => {
  it("defaults to 13 readings, a 6 N minimum, no standard label and 3 decimals: the dictionary's defaults", () => {
    expect(ForceAtBreakConfigSchema.parse(FORCE_AT_BREAK_DEFAULT_CONFIG)).toEqual({
      n: 13,
      specMin: 6,
      standardLabel: null,
      decimals: 3,
    });
    expect(FORCE_AT_BREAK_DEFAULT_CONFIG).toEqual(defaultConfig("force_at_break"));
  });

  it.each(TEMPLATE_CODES)("accepts what the %s template sets (lib/coverage/templates.ts)", (code) => {
    const config = moduleConfig(code, "force_at_break");
    if (config === undefined) return;
    expect(ForceAtBreakConfigSchema.parse(config)).toEqual(config);
  });

  it("is on in STD_EG only, as BUILD_SPEC 11 has it", () => {
    expect(TEMPLATE_CODES.filter((code) => moduleConfig(code, "force_at_break") !== undefined)).toEqual(["STD_EG"]);
  });

  it("resolves STD_EG's seed over its defaults into the template's config, with this schema", () => {
    const spec = TEMPLATES.STD_EG;
    // Only this module is seeded; order_lots is on because a per-size module needs it.
    const definition = {
      code: spec.code,
      name: spec.name,
      scope: { productType: spec.scope.productType, standard: spec.scope.standard },
      unit: spec.unit,
      sizes: spec.sizes.map((size) => ({ ...size })),
      modules: [
        { key: "order_lots", include: true },
        { key: "force_at_break", include: true, config: seedConfig("STD_EG", "force_at_break") },
      ],
    };
    const template = resolveTemplateOrThrow(definition, { getBase: () => undefined, registry: MODULE_REGISTRY });
    expect(template.modules.find((entry) => entry.key === "force_at_break")?.config).toEqual(
      moduleConfig("STD_EG", "force_at_break"),
    );
  });

  it("takes a standard label to print with the spec", () => {
    const config = { ...FORCE_AT_BREAK_DEFAULT_CONFIG, standardLabel: "EN 455" };
    expect(ForceAtBreakConfigSchema.parse(config).standardLabel).toBe("EN 455");
  });

  it("rejects impossible settings and mistyped keys", () => {
    const invalid = [
      { n: 0 },
      { n: 12.5 },
      { n: 501 },
      { specMin: 0 },
      { specMin: -6 },
      { decimals: -1 },
      { decimals: 1.5 },
      { decimals: 7 },
      { standardLabel: "  " },
      { standardLabel: 455 },
      { minimum: 6 },
    ];
    for (const change of invalid) {
      expect(ForceAtBreakConfigSchema.safeParse({ ...FORCE_AT_BREAK_DEFAULT_CONFIG, ...change }).success, JSON.stringify(change)).toBe(
        false,
      );
    }
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(ForceAtBreakConfigSchema) as { properties: Record<string, { description?: string }> };
    for (const key of ["n", "specMin", "standardLabel", "decimals"]) {
      expect(schema.properties[key].description, key).toBeTruthy();
    }
  });
});

describe("force_at_break wording", () => {
  it("uses the dictionary's title and labels: STD_EG's wording", () => {
    expect(FORCE_AT_BREAK_TITLE).toBe(moduleTitle("STD_EG", "force_at_break"));
    expect(FORCE_AT_BREAK_LABELS).toEqual(defaultLabels("force_at_break"));
  });
});
