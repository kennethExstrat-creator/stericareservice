import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { BOX_CARTON_LABEL, BOX_CARTON_NUMBERS, boxCartonNumber, countBoxCartonNumbers } from "./box-carton";
import { plainLabel } from "./caption";

describe("box/carton wording (Kenneth, 13 October 2026: box # and carton # are one number)", () => {
  it("labels it Box/Carton #, in Title Case", () => {
    expect(BOX_CARTON_LABEL).toBe("Box/Carton #");
    expect(lowerCaseWords(BOX_CARTON_LABEL)).toEqual([]);
    expect(lowerCaseWords(`M (${BOX_CARTON_LABEL})`)).toEqual([]);
    expect(plainLabel(BOX_CARTON_LABEL)).toBe("Box/Carton");
  });

  it("names one number Box/Carton #1003 and several box/carton numbers", () => {
    expect(boxCartonNumber(1003)).toBe("Box/Carton #1003");
    expect(boxCartonNumber("12")).toBe("Box/Carton #12");
    expect(`12 of 50 ${BOX_CARTON_NUMBERS}.`).toBe("12 of 50 box/carton numbers.");
  });

  it("counts them in a sentence", () => {
    expect(countBoxCartonNumbers(1)).toBe("1 box/carton number");
    expect(countBoxCartonNumbers(0)).toBe("0 box/carton numbers");
    expect(countBoxCartonNumbers(2000)).toBe("2,000 box/carton numbers");
  });
});
