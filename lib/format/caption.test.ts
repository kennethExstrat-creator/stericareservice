import { describe, expect, it } from "vitest";
import { fillCaption, formatCodeLetters, plainLabel } from "./caption";

describe("fillCaption", () => {
  it("fills the template's placeholders and leaves unknown ones as written", () => {
    expect(
      fillCaption("Freedom from Holes by watertight test (Single sampling code letter {codeLetters}, AQL {aql})", {
        codeLetters: "J & L",
        aql: "1.5",
      }),
    ).toBe("Freedom from Holes by watertight test (Single sampling code letter J & L, AQL 1.5)");
    expect(fillCaption("{size} (Carton #)", {})).toBe("{size} (Carton #)");
    expect(fillCaption("No placeholder", { size: "M" })).toBe("No placeholder");
  });
});

describe("formatCodeLetters", () => {
  it("lists distinct letters in ISO 2859-1 order, as the headings do", () => {
    expect(formatCodeLetters(["L", "J", "L"])).toBe("J & L");
    expect(formatCodeLetters(["E", "C", null, "D"])).toBe("C, D & E");
    expect(formatCodeLetters(["H"])).toBe("H");
  });

  it("is the empty text without letters", () => {
    expect(formatCodeLetters([])).toBe("");
    expect(formatCodeLetters([null, undefined], { empty: "–" })).toBe("–");
  });
});

describe("plainLabel", () => {
  it("drops units and footnote marks for a sentence", () => {
    expect(plainLabel("Layering %")).toBe("Layering");
    expect(plainLabel("Stickiness **")).toBe("Stickiness");
    expect(plainLabel("Box #")).toBe("Box");
    expect(plainLabel("Others:")).toBe("Others");
    expect(plainLabel("** Note")).toBe("Note");
  });

  it("keeps a heading that is only marks", () => {
    expect(plainLabel(" # ")).toBe("#");
  });
});
