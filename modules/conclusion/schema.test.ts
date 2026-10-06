import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultConfig, defaultLabels, labelOverrides, moduleConfig, TEMPLATES, type TemplateCode } from "@/lib/coverage";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { CONCLUSION_DEFAULT_CONFIG, CONCLUSION_LABELS, ConclusionConfigSchema } from "./config";
import { ConclusionDataSchema, emptyConclusion } from "./schema";

const TEMPLATE_CODES = Object.keys(TEMPLATES) as TemplateCode[];
const SIGNATURE = { width: 600, height: 200, strokes: [[10, 150, 40, 60, 80, 140]] };

describe("conclusion data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyConclusion()).toEqual({ finalResult: null, remark: null, date: null, signature: null });
    expect(ConclusionDataSchema.parse({ finalResult: "hold" })).toEqual({ ...emptyConclusion(), finalResult: "hold" });
  });

  it("holds a whole conclusion: result, remark, date and the drawn strokes", () => {
    const filled = { finalResult: "pass", remark: "Shipment released.", date: "2025-04-12", signature: SIGNATURE };
    expect(ConclusionDataSchema.parse(filled)).toEqual(filled);
  });

  it("takes pass, fail or hold only, never the printed word", () => {
    for (const finalResult of ["pass", "fail", "hold"]) {
      expect(ConclusionDataSchema.safeParse({ finalResult }).success).toBe(true);
    }
    for (const finalResult of ["PASSED", "passed", "warn", "not_done", true]) {
      expect(ConclusionDataSchema.safeParse({ finalResult }).success).toBe(false);
    }
  });

  it("takes the date from a picker only: no printed dates, no numbers (6.2 rule 3)", () => {
    // The reports print the date day first (STD_EG) or month first (SAFEDON_EG); the app keeps the picker's ISO date.
    for (const { date } of [STD_EG_EXAMPLE.conclusion, SAFEDON_EG_EXAMPLE.conclusion]) {
      expect(ConclusionDataSchema.parse({ date: date.iso }).date).toBe(date.iso);
      expect(ConclusionDataSchema.safeParse({ date: date.printed }).success, date.printed).toBe(false);
    }
    for (const date of ["2025-02-30", 45_759, "1980-01-01T00:00:00Z"]) {
      expect(ConclusionDataSchema.safeParse({ date }).success, String(date)).toBe(false);
    }
  });

  it("stores the signature as strokes, never as an image", () => {
    expect(ConclusionDataSchema.safeParse({ signature: "data:image/png;base64,AAAA" }).success).toBe(false);
    expect(ConclusionDataSchema.safeParse({ signature: { ...SIGNATURE, strokes: [[1, 2, 3]] } }).success).toBe(false);
  });

  it("rejects fields it does not have: the suggestion is computed, the inspector recorded, the comment reserved", () => {
    for (const extra of [
      { suggestedResult: "pass" },
      { inspector: "Inspector A" },
      { inspectedBy: "Inspector A" },
      { comment: "x" },
    ]) {
      expect(ConclusionDataSchema.safeParse(extra).success, JSON.stringify(extra)).toBe(false);
    }
  });
});

describe("conclusion config", () => {
  it("has none (BUILD_SPEC 6.1), as the dictionary says", () => {
    expect(ConclusionConfigSchema.parse(CONCLUSION_DEFAULT_CONFIG)).toEqual({});
    expect(CONCLUSION_DEFAULT_CONFIG).toEqual(defaultConfig("conclusion"));
    expect(ConclusionConfigSchema.safeParse({ fields: { remark: false } }).success).toBe(false);
  });

  it.each(TEMPLATE_CODES)("accepts %s's conclusion config from lib/coverage", (code) => {
    const config = moduleConfig(code, "conclusion");
    expect(config).toBeDefined();
    expect(ConclusionConfigSchema.parse(config)).toEqual(config);
  });

  it("becomes JSON Schema for the template editor", () => {
    expect(z.toJSONSchema(ConclusionConfigSchema)).toMatchObject({ type: "object", additionalProperties: false });
  });
});

describe("conclusion labels", () => {
  it("are the dictionary's wording, Inspected by included (SAFEDON_EG prints it beside the signature)", () => {
    expect(CONCLUSION_LABELS).toEqual(defaultLabels("conclusion"));
    expect(CONCLUSION_LABELS.inspector).toBe("Inspected by");
  });

  it("need no override in any seed template", () => {
    for (const code of TEMPLATE_CODES) expect(labelOverrides(code, "conclusion")).toEqual({});
  });
});
