import { describe, expect, it } from "vitest";
import { coverEverySize, removeVariant, setGloveType, setIndicativeWeight, setLength, setText, tidyGloveType, tidyText } from "./edit";
import { emptyVariant, TEXT_MAX_LENGTH, type GloveInfoData } from "./schema";

const one = (change: Partial<ReturnType<typeof emptyVariant>> = {}): GloveInfoData => ({ gloveType: null, variants: [{ ...emptyVariant(), ...change }] });

describe("glove_info edits", () => {
  it("creates the variant on screen when the first value is typed, and changes nothing for the same value", () => {
    const typed = setText({ gloveType: null, variants: [] }, 0, "colour", "Blue");
    expect(typed.variants).toEqual([{ ...emptyVariant(), colour: "Blue" }]);
    expect(setText(typed, 0, "colour", "Blue")).toBe(typed);
    expect(setText(typed, 0, "colour", "")).toEqual(one());
  });

  it("keeps text as typed, cut to the schema's limit, and trims it once left", () => {
    expect(setText(one(), 0, "colour", "x".repeat(TEXT_MAX_LENGTH + 5)).variants[0].colour).toHaveLength(TEXT_MAX_LENGTH);
    expect(tidyText(one({ colour: "  Blue " }), 0, "colour").variants[0].colour).toBe("Blue");
    expect(tidyText(one({ colour: "   " }), 0, "colour").variants[0].colour).toBeNull();
    expect(tidyText({ gloveType: null, variants: [] }, 0, "colour")).toEqual({ gloveType: null, variants: [] });
  });

  it("keeps the Glove Type once for the inspection, trimmed once left", () => {
    const typed = setGloveType(one(), "Nitrile, powder free ");
    expect(typed.gloveType).toBe("Nitrile, powder free ");
    expect(setGloveType(typed, "Nitrile, powder free ")).toBe(typed);
    expect(tidyGloveType(typed).gloveType).toBe("Nitrile, powder free");
    expect(tidyGloveType(setGloveType(one(), "  ")).gloveType).toBeNull();
    expect(setGloveType(typed, "").gloveType).toBeNull();
  });

  it("sets the weight of the variant it is typed in", () => {
    const saved: GloveInfoData = { gloveType: null, variants: [{ ...emptyVariant(), colour: "Blue" }, emptyVariant()] };
    const data = setIndicativeWeight(saved, 1, 4.2);
    expect(data.variants.map((variant) => variant.indicativeWeight)).toEqual([null, 4.2]);
  });

  it("sets the length in mm, and reads a length saved as printed text as its number", () => {
    expect(setLength(one(), 0, 240).variants[0].length).toBe(240);
    expect(setLength(one({ length: 240 }), 0, null).variants[0].length).toBeNull();
  });

  it("makes a glove saved for some sizes cover every size (one glove per inspection, Kenneth, 26 October 2026)", () => {
    const saved = one({ sizes: ["S", "L"], colour: "Blue" });
    expect(coverEverySize(saved, 0).variants[0]).toEqual({ ...emptyVariant(), colour: "Blue" });
    const every = one({ colour: "Blue" });
    expect(coverEverySize(every, 0)).toBe(every);
    expect(coverEverySize(every, 3)).toBe(every);
  });

  it("removes a variant saved before one glove per inspection, never the last one left", () => {
    const two: GloveInfoData = { gloveType: null, variants: [{ ...emptyVariant(), colour: "Blue" }, { ...emptyVariant(), colour: "White" }] };
    expect(removeVariant(two, 0).variants).toEqual([{ ...emptyVariant(), colour: "White" }]);
    expect(removeVariant(two, 1).variants).toEqual([{ ...emptyVariant(), colour: "Blue" }]);
    expect(removeVariant(two, 5)).toBe(two);
    const glove = one({ colour: "Blue" });
    expect(removeVariant(glove, 0)).toBe(glove);
  });
});
