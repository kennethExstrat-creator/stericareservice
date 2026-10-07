// What a number field stores for what is typed (B1 of the editor review: an
// emptied setting must never turn back into the value it inherits under the
// caret). The browser half, keeping the typed text while the field has focus,
// is covered in e2e/editor.
import { describe, expect, it } from "vitest";
import { numberFromText, numberText } from "./controls";

describe("numberFromText", () => {
  it("stores numbers, with a decimal comma read as a point", () => {
    expect(numberFromText("13", "missing")).toBe(13);
    expect(numberFromText(" 2,5 ", "missing")).toBe(2.5);
    expect(numberFromText("-0.25", "null")).toBe(-0.25);
  });

  it("stores an emptied field as missing (it inherits) or null (it stays the template's own, empty)", () => {
    expect(numberFromText("", "missing")).toBeUndefined();
    expect(numberFromText("   ", "missing")).toBeUndefined();
    expect(numberFromText("", "null")).toBeNull();
  });

  it("stores text that is not one number as typed, trimmed, for the schema to refuse", () => {
    expect(numberFromText("2 40", "missing")).toBe("2 40");
    expect(numberFromText(" 3.5 g ", "null")).toBe("3.5 g");
    expect(numberFromText("1,234", "missing")).toBe("1,234");
  });
});

describe("numberText", () => {
  it("shows a number, text that is not one yet, and nothing for none", () => {
    expect(numberText(13)).toBe("13");
    expect(numberText(0)).toBe("0");
    expect(numberText("2 40")).toBe("2 40");
    expect(numberText(null)).toBe("");
    expect(numberText(undefined)).toBe("");
  });
});
