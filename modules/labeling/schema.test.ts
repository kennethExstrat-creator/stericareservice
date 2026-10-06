import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defaultConfig,
  defaultLabels,
  LABELLING_CHECK_LISTS,
  LABELLING_CHECKS,
  LABELLING_LEVELS,
  labelOverrides,
  moduleConfig,
  seedConfig,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { mergeConfig, type JsonObject } from "@/lib/templates";
import {
  LABELING_CHECKS,
  LABELING_DEFAULT_CONFIG,
  LABELING_LABELS,
  LABELING_LEVELS,
  LabelingConfigSchema,
  type LabelingConfig,
} from "./config";
import { emptyLabeling, emptyLabelingSize, LabelingDataSchema } from "./schema";

const TEMPLATE_CODES = Object.keys(TEMPLATES) as TemplateCode[];

function withLevel(level: "inner" | "carton", patch: Partial<LabelingConfig["levels"]["inner"]>): unknown {
  const levels = LABELING_DEFAULT_CONFIG.levels;
  return { levels: { ...levels, [level]: { ...levels[level], ...patch } } };
}

describe("labeling data", () => {
  it("starts empty and fills a size in as both levels with nothing recorded", () => {
    expect(emptyLabeling()).toEqual({ sizes: {} });
    expect(emptyLabelingSize()).toEqual({
      inner: { inspected: null, boxNos: [], defects: {} },
      carton: { inspected: null, boxNos: [], defects: {} },
    });
    expect(LabelingDataSchema.parse({ sizes: { M: { carton: { inspected: 1 } } } })).toEqual({
      sizes: {
        M: {
          inner: { inspected: null, boxNos: [], defects: {} },
          carton: { inspected: 1, boxNos: [], defects: {} },
        },
      },
    });
  });

  it("keeps counts and box numbers as whole numbers, never text or dates (6.2 rules 1 and 3)", () => {
    const sized = (level: unknown) => ({ sizes: { M: { inner: level } } });
    expect(LabelingDataSchema.parse(sized({ inspected: 3, boxNos: [253, 253], defects: { lot_no: 1 } }))).toBeTruthy();
    for (const level of [
      { inspected: "3" },
      { inspected: "2025-04-01" },
      { inspected: 2.5 },
      { inspected: -1 },
      { defects: { lot_no: "1" } },
      { defects: { lot_no: 0.5 } },
      { defects: { lot_no: -1 } },
      { defects: { lot_no: null } },
      { boxNos: ["253"] },
      { boxNos: [0] },
      { boxNos: [null] },
    ]) {
      expect(LabelingDataSchema.safeParse(sized(level)).success, JSON.stringify(level)).toBe(false);
    }
  });

  it("takes only labelling check codes and the two levels, and no reserved comment", () => {
    expect(LabelingDataSchema.safeParse({ sizes: { M: { inner: { defects: { wrong_size: 1 } } } } }).success).toBe(false);
    expect(LabelingDataSchema.safeParse({ sizes: { M: { pallet: {} } } }).success).toBe(false);
    expect(LabelingDataSchema.safeParse({ sizes: { M: { inner: { inspected: 3, note: "x" } } } }).success).toBe(false);
    expect(LabelingDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });
});

describe("labeling config", () => {
  it("is the dictionary's default: STD_EG's 3 dispenser boxes and 1 carton with their checks", () => {
    expect(LabelingConfigSchema.parse(LABELING_DEFAULT_CONFIG)).toEqual(LABELING_DEFAULT_CONFIG);
    expect(LABELING_DEFAULT_CONFIG).toEqual(defaultConfig("labeling"));
    expect(LABELING_DEFAULT_CONFIG).toEqual(moduleConfig("STD_EG", "labeling"));
  });

  it("uses the dictionary's levels and check codes", () => {
    expect(LABELING_LEVELS).toEqual(LABELLING_LEVELS);
    expect(LABELING_CHECKS).toEqual(LABELLING_CHECKS);
  });

  it.each(TEMPLATE_CODES)("accepts %s's labelling config from lib/coverage", (code) => {
    const config = moduleConfig(code, "labeling");
    if (config === undefined) {
      // STD_SG has no labelling module (BUILD_SPEC 11).
      expect(TEMPLATES[code].modules.map((entry) => entry.key)).not.toContain("labeling");
      return;
    }
    expect(LabelingConfigSchema.parse(config)).toEqual(config);
  });

  it("resolves SAFEDON_EG from its seed over STD_EG, as the framework merges: expiry date at both levels", () => {
    const base = mergeConfig(LABELING_DEFAULT_CONFIG as unknown as JsonObject, seedConfig("STD_EG", "labeling") as JsonObject);
    const safedon = mergeConfig(base, seedConfig("SAFEDON_EG", "labeling") as JsonObject);
    const parsed = LabelingConfigSchema.parse(safedon);
    expect(parsed).toEqual(moduleConfig("SAFEDON_EG", "labeling"));
    expect(parsed.levels.inner.checks).toEqual(LABELLING_CHECK_LISTS.SAFEDON_EG.inner);
    expect(parsed.levels.carton.checks.map((check) => check.code)).toEqual([
      "lot_no",
      "mfg_date",
      "expiry_date",
      "artwork",
      "carton_no",
    ]);
  });

  it("rejects an unknown check, a check listed twice, a blank label, n below 1 and an inspected level with no checks", () => {
    const inner = LABELING_DEFAULT_CONFIG.levels.inner;
    for (const config of [
      withLevel("inner", { checks: [{ code: "wrong_size" as "lot_no", label: "Wrong size" }] }),
      withLevel("inner", { checks: [inner.checks[0], inner.checks[0]] }),
      withLevel("inner", { checks: [{ code: "lot_no", label: "  " }] }),
      withLevel("inner", { n: 0 }),
      withLevel("inner", { n: 2.5 }),
      withLevel("carton", { checks: [] }),
      { levels: { inner } },
      { ...LABELING_DEFAULT_CONFIG, aql: 1.5 },
    ]) {
      expect(LabelingConfigSchema.safeParse(config).success, JSON.stringify(config)).toBe(false);
    }
  });

  it("lets a level be switched off, with or without checks", () => {
    expect(LabelingConfigSchema.safeParse(withLevel("carton", { include: false })).success).toBe(true);
    expect(LabelingConfigSchema.safeParse(withLevel("carton", { include: false, checks: [] })).success).toBe(true);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(LabelingConfigSchema) as unknown as {
      properties: { levels: { description?: string; properties: Record<string, { description?: string }> } };
    };
    expect(schema.properties.levels.description).toContain("Levels on or off");
    expect(schema.properties.levels.properties.inner.description).toContain("Inner unit");
  });
});

describe("labeling labels", () => {
  it("are the dictionary's STD_EG wording, with the carton line's [sic] fixed", () => {
    expect(LABELING_LABELS).toEqual(defaultLabels("labeling"));
    expect(LABELING_LABELS.cartonResult).toBe("Disposition - Carton Box (Passed / Failed)");
  });

  it("cover every key a seed template relabels: SAFEDON_EG's level names and limit caption", () => {
    const overrides = labelOverrides("SAFEDON_EG", "labeling");
    expect(overrides).toEqual({
      innerLevel: "Inner Boxes/Packs",
      cartonLevel: "Carton Boxes",
      defectLimit: "Limit : Accept / Reject",
    });
    for (const key of Object.keys(overrides)) expect(Object.keys(LABELING_LABELS)).toContain(key);
  });
});
