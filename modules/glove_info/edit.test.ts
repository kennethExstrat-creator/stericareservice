import { describe, expect, it } from "vitest";
import { addVariant, removeVariant, setIndicativeWeight, setLength, setText, tidyText, toggleSize } from "./edit";
import { emptyGloveInfo, emptyVariant, TEXT_MAX_LENGTH, type GloveInfoData } from "./schema";

const ORDER = ["XS", "S", "M", "L", "XL"];
const one = (change: Partial<ReturnType<typeof emptyVariant>> = {}): GloveInfoData => ({ variants: [{ ...emptyVariant(), ...change }] });

describe("glove_info edits", () => {
  it("creates the variant on screen when the first value is typed, and changes nothing for the same value", () => {
    const typed = setText({ variants: [] }, 0, "colour", "Blue");
    expect(typed.variants).toEqual([{ ...emptyVariant(), colour: "Blue" }]);
    expect(setText(typed, 0, "colour", "Blue")).toBe(typed);
    expect(setText(typed, 0, "colour", "")).toEqual(one());
  });

  it("keeps text as typed, cut to the schema's limit, and trims it once left", () => {
    expect(setText(one(), 0, "colour", "x".repeat(TEXT_MAX_LENGTH + 5)).variants[0].colour).toHaveLength(TEXT_MAX_LENGTH);
    expect(tidyText(one({ colour: "  Blue " }), 0, "colour").variants[0].colour).toBe("Blue");
    expect(tidyText(one({ colour: "   " }), 0, "colour").variants[0].colour).toBeNull();
    expect(tidyText({ variants: [] }, 0, "colour")).toEqual({ variants: [] });
  });

  it("sets the weight of the variant it is typed in", () => {
    const data = setIndicativeWeight(addVariant(one({ colour: "Blue" })), 1, 4.2);
    expect(data.variants.map((variant) => variant.indicativeWeight)).toEqual([null, 4.2]);
  });

  it("sets the length in mm, and reads a length saved as printed text as its number", () => {
    expect(setLength(one(), 0, 240).variants[0].length).toBe(240);
    expect(setLength(one({ length: 240 }), 0, null).variants[0].length).toBeNull();
  });

  it("picks and drops sizes, kept in the template's order", () => {
    let data = toggleSize(one(), 0, "L", ORDER);
    data = toggleSize(data, 0, "S", ORDER);
    expect(data.variants[0].sizes).toEqual(["S", "L"]);
    expect(toggleSize(data, 0, "S", ORDER).variants[0].sizes).toEqual(["L"]);
  });

  it("adds a variant (two while none is saved: the one on screen and the new one) and removes one", () => {
    expect(addVariant({ variants: [] }).variants).toHaveLength(2);
    expect(addVariant(emptyGloveInfo()).variants).toHaveLength(2);
    const two = addVariant(one({ colour: "Blue" }));
    expect(removeVariant(two, 0).variants).toEqual([emptyVariant()]);
    expect(removeVariant(two, 5)).toBe(two);
  });
});
