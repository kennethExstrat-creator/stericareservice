import { describe, expect, it } from "vitest";
import { codeLettersOf, fillPlaceholders, inSentence, joinWithAmpersand, joinWithAnd, plainLabel } from "./text";

describe("dispensing_packing wording", () => {
  it("takes a column heading's words without its unit or footnote marks", () => {
    expect(plainLabel("Layering %")).toBe("Layering");
    expect(plainLabel("Stickiness **")).toBe("Stickiness");
    expect(plainLabel("**Glove stickiness Code")).toBe("Glove stickiness Code");
    expect(plainLabel("Box #")).toBe("Box");
    expect(plainLabel("Others:")).toBe("Others");
    expect(plainLabel("Layering (%)")).toBe("Layering (%)");
    expect(plainLabel(" # ")).toBe("#");
  });

  it("puts a label inside a sentence, acronyms kept", () => {
    expect(inSentence("Item")).toBe("item");
    expect(inSentence("No.")).toBe("no.");
    expect(inSentence("PO line")).toBe("PO line");
    expect(inSentence("#")).toBe("#");
  });

  it("lists code letters as the headings do, in table order", () => {
    expect(joinWithAmpersand([])).toBe("");
    expect(joinWithAmpersand(["E"])).toBe("E");
    expect(joinWithAmpersand(["D", "E"])).toBe("D & E");
    expect(joinWithAmpersand(["K", "L", "M"])).toBe("K, L & M");
    expect(codeLettersOf(["E", null, "C", "E"])).toEqual(["C", "E"]);
  });

  it("lists words inside a sentence with a comma and a last 'and'", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["Stickiness"])).toBe("Stickiness");
    expect(joinWithAnd(["Dispensing", "Stickiness"])).toBe("Dispensing and Stickiness");
    expect(joinWithAnd(["Layering", "Dispensing", "Stickiness"])).toBe("Layering, Dispensing and Stickiness");
  });

  it("fills the placeholders it has values for and leaves the others visible", () => {
    expect(fillPlaceholders("min. {minLayeringPct}% layering ({codeLetters}) {unknown}", { minLayeringPct: "70", codeLetters: "E" })).toBe(
      "min. 70% layering (E) {unknown}",
    );
  });
});
