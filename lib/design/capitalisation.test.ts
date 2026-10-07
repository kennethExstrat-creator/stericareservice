import { describe, expect, it } from "vitest";
import { lowerCaseWords, SMALL_WORDS } from "./capitalisation";
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
    "Secret Key (Server Only)",
    "Forgot Password?",
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
  ])("names the words that break it in %j", (label, words) => {
    expect(lowerCaseWords(label)).toEqual(words);
  });

  it("lets a small word start with a capital, as in a verb's Sign In", () => {
    expect(lowerCaseWords("Stay Signed In")).toEqual([]);
    expect(lowerCaseWords("Stay Signed in")).toEqual([]);
  });

  it("keeps the rule's eighteen small words", () => {
    expect([...SMALL_WORDS]).toEqual(
      "a an the and but or nor of in on at to by for per via vs as".split(" "),
    );
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
