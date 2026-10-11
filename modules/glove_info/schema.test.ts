import { describe, expect, it } from "vitest";
import { emptyGloveInfo, GloveInfoDataSchema, MAX_VARIANTS } from "./schema";

describe("glove_info data", () => {
  it("starts with one blank variant, and reads nothing saved as no variants", () => {
    expect(emptyGloveInfo()).toEqual({
      variants: [{ sizes: [], gloveType: null, surfaceTexture: null, indicativeWeight: null, colour: null, length: null }],
    });
    expect(GloveInfoDataSchema.parse({})).toEqual({ variants: [] });
  });

  it("reads one set of values saved before variants as a first variant covering every size", () => {
    expect(GloveInfoDataSchema.parse({ surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: null })).toEqual({
      variants: [{ sizes: [], gloveType: null, surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: null }],
    });
  });

  it("fills a value written straight onto the module into the first variant where it is empty", () => {
    const parsed = GloveInfoDataSchema.parse({
      colour: "White",
      variants: [{ sizes: ["M"], gloveType: null, surfaceTexture: "Smooth", indicativeWeight: null, colour: null, length: null }],
    });
    expect(parsed.variants[0]).toMatchObject({ sizes: ["M"], gloveType: null, surfaceTexture: "Smooth", colour: "White" });
  });

  it("refuses sizes the app does not know, unknown keys and too many variants", () => {
    expect(GloveInfoDataSchema.safeParse({ variants: [{ sizes: ["XXXL"] }] }).success).toBe(false);
    expect(GloveInfoDataSchema.safeParse({ variants: [{ shade: "Blue" }] }).success).toBe(false);
    expect(GloveInfoDataSchema.safeParse({ variants: Array.from({ length: MAX_VARIANTS + 1 }, () => ({})) }).success).toBe(false);
  });
});
