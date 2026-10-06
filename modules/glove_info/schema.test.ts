import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GLOVE_INFO_DEFAULT_CONFIG, GloveInfoConfigSchema } from "./config";
import { emptyGloveInfo, GloveInfoDataSchema } from "./schema";

describe("glove_info data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyGloveInfo()).toEqual({ surfaceTexture: null, indicativeWeight: null, colour: null, length: null });
    expect(GloveInfoDataSchema.parse({ colour: "Blue" })).toEqual({ ...emptyGloveInfo(), colour: "Blue" });
  });

  it("stores the indicative weight as a number, never as text (6.2 rule 1)", () => {
    expect(GloveInfoDataSchema.parse({ indicativeWeight: 3.5 }).indicativeWeight).toBe(3.5);
    for (const text of ["3.5", "3 5", "3.5 g"]) {
      expect(GloveInfoDataSchema.safeParse({ indicativeWeight: text }).success).toBe(false);
    }
  });

  it("keeps the length as printed: text, not a measurement", () => {
    expect(GloveInfoDataSchema.parse({ length: "240 mm minimum" }).length).toBe("240 mm minimum");
  });

  it("rejects fields it does not have, the reserved comment included", () => {
    expect(GloveInfoDataSchema.safeParse({ color: "Blue" }).success).toBe(false);
    expect(GloveInfoDataSchema.safeParse({ comment: "x" }).success).toBe(false);
  });
});

describe("glove_info config", () => {
  it("shows every field for size M by default", () => {
    expect(GloveInfoConfigSchema.parse(GLOVE_INFO_DEFAULT_CONFIG)).toEqual({
      fields: { surfaceTexture: true, indicativeWeight: true, colour: true, length: true },
      indicativeWeightSize: "M",
    });
  });

  it("rejects a mistyped field and a size that is not canonical", () => {
    const typo = { ...GLOVE_INFO_DEFAULT_CONFIG, fields: { ...GLOVE_INFO_DEFAULT_CONFIG.fields, color: false } };
    expect(GloveInfoConfigSchema.safeParse(typo).success).toBe(false);
    expect(GloveInfoConfigSchema.safeParse({ ...GLOVE_INFO_DEFAULT_CONFIG, indicativeWeightSize: "m" }).success).toBe(false);
    expect(GloveInfoConfigSchema.safeParse({ ...GLOVE_INFO_DEFAULT_CONFIG, indicativeWeightSize: "7.0" }).success).toBe(true);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(GloveInfoConfigSchema) as {
      properties: Record<string, { description?: string }>;
    };
    expect(schema.properties.fields.description).toBe("Fields shown on this template");
    expect(schema.properties.indicativeWeightSize.description).toContain("indicative weight");
  });
});
