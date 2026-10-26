import { describe, expect, it } from "vitest";
import { lowerCaseWords, SMALL_WORDS, staysLowerCase, UNITS } from "./capitalisation";
import { STATUSES, STATUS_LABEL } from "./status";

describe("lowerCaseWords (docs/DESIGN.md, Capitalisation)", () => {
  it.each([
    "Product Type",
    "Product Name (Optional)",
    "Start From Previous",
    "Date of Inspection",
    "Gloves per Case",
    "Inspector in Charge",
    "Submit for Review",
    "Not Done",
    "On Hold",
    "New Inspection",
    "Follow-Up",
    "Sign In",
    "Back to Sign In",
    "Sign-In Emails",
    "Set-Up",
    "Secret Key (Server Only)",
    "Forgot Password?",
    "Leave This Page?",
    "Used In",
    "Map To",
    "Shown As",
    "Base Moved On",
    "Accent: Logo Teal (The Brand, Never a Result)",
    "No: Keeps Its Own Value",
    "Count (Tap + and −)",
    "Switching Off…",
    // "#" reads "Number": "of" is in the middle (Kenneth, 27 October 2026).
    "# of Case",
    "Total # of Inner Box",
    "# Gloves for Dimension",
  ])("passes %j", (label) => {
    expect(lowerCaseWords(label)).toEqual([]);
  });

  it.each([
    ["Product type", ["type"]],
    ["Product name (optional)", ["name", "optional"]],
    ["Sign-in emails", ["in", "emails"]],
    ["Follow-up", ["up"]],
    ["the first word", ["the", "first", "word"]],
    ["Not done", ["done"]],
    ["Used in", ["in"]],
    ["Base Moved on", ["on"]],
    ["Accent: the Brand", ["the"]],
    ["Logo Teal (the Brand, Never a Result)", ["the"]],
    ["# of case", ["case"]],
    ["of Case", ["of"]],
  ])("names the words that break it in %j", (label, words) => {
    expect(lowerCaseWords(label)).toEqual(words);
  });

  it("lets a small word in the middle start with a capital, as in a verb's Sign In; the last word always takes one", () => {
    expect(lowerCaseWords("Stay Signed In")).toEqual([]);
    expect(lowerCaseWords("Sign In Again")).toEqual([]);
    expect(lowerCaseWords("Stay Signed in")).toEqual(["in"]);
  });

  it("keeps the rule's eighteen small words", () => {
    expect([...SMALL_WORDS]).toEqual(
      "a an the and but or nor of in on at to by for per via vs as".split(" "),
    );
  });

  it.each(["Weight (g)", "Weight (g) - Average of 13 Gloves per Size", "Finger Thickness (mm)", "Gloves (pcs)", "Unit: pairs"])(
    "leaves a unit as it is: %j",
    (label) => {
      expect(lowerCaseWords(label)).toEqual([]);
    },
  );

  it("takes a word in brackets for a word, not a unit", () => {
    expect(lowerCaseWords("Qty (cases)")).toEqual(["cases"]);
    expect(lowerCaseWords("Weight (grams)")).toEqual(["grams"]);
  });

  it("knows the units of docs/DESIGN.md", () => {
    expect([...UNITS]).toEqual(["mm", "g", "N", "MPa", "%", "pcs", "pairs"]);
  });
});

describe("staysLowerCase", () => {
  it("keeps a small word lower case in the middle only", () => {
    const words = ["Boxes", "per", "Size"];
    expect(words.map((word, index) => staysLowerCase(word, index, words.length))).toEqual([false, true, false]);
    expect(staysLowerCase("as", 1, 2)).toBe(false);
    expect(staysLowerCase("the", 0, 3)).toBe(false);
    expect(staysLowerCase("Charge", 2, 3)).toBe(false);
  });
});

describe("the pill words", () => {
  it.each(STATUSES)("%s is in Title Case", (status) => {
    expect(lowerCaseWords(STATUS_LABEL[status])).toEqual([]);
  });

  it("say On Hold and Not Done", () => {
    expect(STATUS_LABEL).toEqual({
      pass: "Passed",
      fail: "Failed",
      warn: "Warning",
      hold: "On Hold",
      info: "Info",
      not_done: "Not Done",
    });
  });
});
