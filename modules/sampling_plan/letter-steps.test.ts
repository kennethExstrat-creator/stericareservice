import { describe, expect, it } from "vitest";
import { CODE_LETTERS, SAMPLE_SIZES } from "@/lib/aql";
import { isBelow, letterSample, letterSteps, nextCodeLetter, previousCodeLetter } from "./letter-steps";

describe("the Code Letter row's steps (Kenneth, 27 October 2026)", () => {
  it("steps in ISO 2859-1 order, which skips I and O: H down is G, J down is H, P down is N", () => {
    expect(previousCodeLetter("N")).toBe("M");
    expect(previousCodeLetter("H")).toBe("G");
    expect(previousCodeLetter("J")).toBe("H");
    expect(previousCodeLetter("P")).toBe("N");
    expect(nextCodeLetter("H")).toBe("J");
    expect(nextCodeLetter("N")).toBe("P");
    // Nothing before A or after R.
    expect(previousCodeLetter("A")).toBeNull();
    expect(nextCodeLetter("R")).toBeNull();
    // Down then up is where it started, all the way along.
    for (const letter of CODE_LETTERS.slice(1)) expect(nextCodeLetter(previousCodeLetter(letter)!)).toBe(letter);
  });

  it("orders the letters by their samples", () => {
    expect(isBelow("M", "N")).toBe(true);
    expect(isBelow("N", "N")).toBe(false);
    expect(isBelow("P", "N")).toBe(false);
    expect(isBelow("H", "J")).toBe(true);
  });

  it("takes a letter's Table 2-A sample, every glove of a lot no larger, the sample alone while the lot is not known", () => {
    expect(letterSample("M", 5_800_000)).toBe(315);
    expect(letterSample("N", 240_000)).toBe(500);
    expect(letterSample("M", 200)).toBe(200);
    expect(letterSample("M", null)).toBe(315);
    for (const letter of CODE_LETTERS) expect(letterSample(letter, null)).toBe(SAMPLE_SIZES[letter]);
  });

  it("offers Reduce down to A, never without a letter", () => {
    expect(letterSteps("N", "N").reduceTo).toBe("M");
    expect(letterSteps("B", "N").reduceTo).toBe("A");
    expect(letterSteps("A", "N").reduceTo).toBeNull();
    expect(letterSteps(null, "N").reduceTo).toBeNull();
    // The lot need not be known to go down.
    expect(letterSteps("N", null).reduceTo).toBe("M");
  });

  it("offers Raise only while the letter is below its lot's, back up to it and never above, and not while the lot is not known", () => {
    expect(letterSteps("M", "N").raiseTo).toBe("N");
    expect(letterSteps("L", "N").raiseTo).toBe("M");
    expect(letterSteps("N", "N").raiseTo).toBeNull();
    expect(letterSteps("P", "N").raiseTo).toBeNull();
    expect(letterSteps("M", null).raiseTo).toBeNull();
    expect(letterSteps(null, "N").raiseTo).toBeNull();
  });

  it("says the letter was reduced, and from what, only while it is below its lot's", () => {
    expect(letterSteps("M", "N").reducedFrom).toBe("N");
    expect(letterSteps("L", "N").reducedFrom).toBe("N");
    expect(letterSteps("N", "N").reducedFrom).toBeNull();
    expect(letterSteps("P", "N").reducedFrom).toBeNull();
    expect(letterSteps("M", null).reducedFrom).toBeNull();
  });
});
