import { describe, expect, it } from "vitest";
import { emptyGloveInfo, GloveInfoDataSchema, MAX_VARIANTS } from "./schema";

describe("glove_info data", () => {
  it("starts with one blank variant, and reads nothing saved as no variants", () => {
    expect(emptyGloveInfo()).toEqual({
      gloveType: null,
      variants: [{ sizes: [], surfaceTexture: null, indicativeWeight: null, colour: null, length: null }],
    });
    expect(GloveInfoDataSchema.parse({})).toEqual({ gloveType: null, variants: [] });
  });

  it("reads one set of values saved before variants as a first variant covering every size", () => {
    expect(GloveInfoDataSchema.parse({ surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: null })).toEqual({
      gloveType: null,
      variants: [{ sizes: [], surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: null }],
    });
  });

  it("takes a variant's Glove Type (11 October 2026) as the module's, where the module has none", () => {
    const lifted = GloveInfoDataSchema.parse({ variants: [{ gloveType: null, colour: "Blue" }, { gloveType: "Nitrile, powder free" }] });
    expect(lifted.gloveType).toBe("Nitrile, powder free");
    expect(lifted.variants.every((variant) => !("gloveType" in variant))).toBe(true);
    expect(GloveInfoDataSchema.parse({ gloveType: "Latex", variants: [{ gloveType: "Nitrile" }] }).gloveType).toBe("Latex");
  });

  it("fills a value written straight onto the module into the first variant where it is empty", () => {
    const parsed = GloveInfoDataSchema.parse({
      colour: "White",
      variants: [{ sizes: ["M"], surfaceTexture: "Smooth", indicativeWeight: null, colour: null, length: null }],
    });
    expect(parsed.variants[0]).toMatchObject({ sizes: ["M"], surfaceTexture: "Smooth", colour: "White" });
  });

  it("reads a glove length saved as printed text as its number in mm", () => {
    const parsed = GloveInfoDataSchema.parse({ variants: [{ length: "240 mm minimum" }, { length: "n/a" }, { length: 300 }] });
    expect(parsed.variants.map((variant) => variant.length)).toEqual([240, null, 300]);
  });

  it("refuses sizes the app does not know, unknown keys and too many variants", () => {
    expect(GloveInfoDataSchema.safeParse({ variants: [{ sizes: ["XXXL"] }] }).success).toBe(false);
    expect(GloveInfoDataSchema.safeParse({ variants: [{ shade: "Blue" }] }).success).toBe(false);
    expect(GloveInfoDataSchema.safeParse({ variants: Array.from({ length: MAX_VARIANTS + 1 }, () => ({})) }).success).toBe(false);
  });
});
