// The checks a Steri-AI Summary draft passes before an inspector sees it (12
// October 2026), on the prompt lab's answers among others.
import { describe, expect, it } from "vitest";
import type { InspectionResult } from "@/lib/schemas/common";
import { LAB_CALL_3, LAB_INSPECTION_FACTS, LAB_OPUS_PARAGRAPH_LIST, LAB_SONNET_HEADED } from "./__fixtures__/summary-answers";
import { FORBIDDEN_TERMS, hardCheckProblems, unknownFigures, type HardCheckInput } from "./summary-checks";
import { answerToDoc, appendHouseWording, summaryPlainText, type SummaryAnswer } from "./summary-doc";

const WORDS = { pass: "PASSED", fail: "FAILED", hold: "HOLD" };

function check(answer: SummaryAnswer, overrides: Partial<Omit<HardCheckInput, "answer" | "doc" | "full">> & { closing?: string } = {}): string[] {
  const { closing, ...rest } = overrides;
  const { doc } = answerToDoc(answer, { words: WORDS, emphasis: "result_and_issues", colourResult: false });
  const full = appendHouseWording(doc, { verdict: null, closing: closing ?? null });
  return hardCheckProblems({
    answer,
    doc,
    full,
    mode: "write",
    finalResult: "pass" as InspectionResult,
    words: WORDS,
    language: "en-GB",
    mentionSuggestion: false,
    ...rest,
  });
}

const one = (...items: string[]): SummaryAnswer => ({ blocks: [{ type: "paragraph", items }], notes: [] });

describe("the hard checks", () => {
  it("pass a complete draft that states the conclusion", () => {
    expect(check(one("The inspection concluded **PASSED**. Weight passed with a warning."))).toEqual([]);
    expect(check(LAB_SONNET_HEADED, { mentionSuggestion: true })).toEqual([]);
  });

  it("catch the lab's third call twice: it broke off, and before the conclusion word", () => {
    expect(check(LAB_CALL_3)).toEqual([
      'stopped mid-sentence ("… ([SO]), size M, 2,900 cartons, concluded")',
      "did not state the conclusion, PASSED",
    ]);
  });

  it("take a full stop, a question or an exclamation mark, in Chinese too, a closing bracket or quote after it", () => {
    expect(check(one("The lot **PASSED** (as recorded.)", 'Labels read "LOT A."', "检验结论为 **PASSED**。"))).toEqual([]);
    expect(check(one("The lot **PASSED**:"))).toEqual(['stopped mid-sentence ("The lot PASSED:")']);
  });

  it("refuse an empty paragraph or point, and an answer with nothing in it", () => {
    expect(check(one("The lot **PASSED**.", "   "))).toEqual(["had an empty paragraph or list point"]);
    expect(check({ blocks: [{ type: "bullet_list", items: ["** **"] }], notes: [] })).toEqual(["had an empty paragraph or list point"]);
  });

  it("refuse another conclusion word while the suggested result is not to be mentioned", () => {
    // The lab's fifth call named the suggested HOLD: right only with the switch on.
    expect(check(LAB_OPUS_PARAGRAPH_LIST)).toEqual([
      "used HOLD, though the conclusion is PASSED and the suggested result is not to be mentioned",
    ]);
    expect(check(LAB_OPUS_PARAGRAPH_LIST, { mentionSuggestion: true })).toEqual([]);
  });

  it("allow another conclusion word only in the sentence about the suggested result, with the switch on", () => {
    const loose = one("The inspection concluded **PASSED**. Weight was FAILED by the scale.");
    expect(check(loose, { mentionSuggestion: true })).toEqual([
      "used FAILED outside the sentence about the suggested result, though the conclusion is PASSED",
    ]);
    expect(check(one("The inspection concluded **FAILED**. The suggested result was HOLD, as Weight was not done."), {
      finalResult: "fail",
      mentionSuggestion: true,
    })).toEqual([]);
  });

  it("check the conclusion word in the template's words, and the other words only in English", () => {
    const words = { pass: "ACCEPTED", fail: "REJECTED", hold: "ON HOLD" };
    expect(check(one("The goods were ACCEPTED."), { words })).toEqual([]);
    expect(check(one("The goods PASSED."), { words })).toEqual(["did not state the conclusion, ACCEPTED"]);
    expect(check(one("Barang diterima, **PASSED**; tiada HOLD."), { language: "ms" })).toEqual([]);
    expect(check(one("Goods **PASSED**; no HOLD."), { language: "en-US" })).toHaveLength(1);
  });

  it("find the conclusion word against Chinese characters, with no space either side, but not inside a longer word", () => {
    expect(check(one("本次检验结论为**PASSED**。重量低于参考值。"), { language: "zh-Hans" })).toEqual([]);
    expect(check(one("本次检验结论为PASSED。"), { language: "zh-Hans" })).toEqual([]);
    expect(check(one("The lot UNPASSED and PASSEDX."))).toEqual(["did not state the conclusion, PASSED"]);
  });

  it("skip the conclusion checks when polishing the inspector's own text", () => {
    expect(check(one("Weight passed. The suggested result was HOLD."), { mode: "polish" })).toEqual([]);
    expect(check(one("Weight passed."), { mode: "write", finalResult: null })).toEqual([]);
  });

  it.each([
    ["Steri-AI", "Steri-AI drafted the summary."],
    ["SteriAI", "SteriAI drafted the summary."],
    ["AI", "The AI found no problem."],
    ["JSON", "The JSON shows a pass."],
    ["not_done", "Weight was not_done."],
    ["module", "The weight module passed."],
    ["modules", "All modules passed."],
    ["https://", "See https://example.com for the report."],
    ["qc@example.com", "Write to qc@example.com for more."],
    ["{codeLetters}", "Code letter {codeLetters} applied."],
  ])("refuse a summary that mentions %s", (term, sentence) => {
    expect(check(one(`The inspection concluded **PASSED**. ${sentence}`))).toEqual([`mentioned "${term}", which a summary never mentions`]);
  });

  it("let words that only contain the terms pass", () => {
    expect(FORBIDDEN_TERMS.test("The PAIR of gloves, the AQL plan and the modular cartons passed; Modules aside.")).toBe(false);
  });

  it("refuse a draft that, with the house wording, is over the field's 5,000 characters", () => {
    const long = one(`The inspection concluded **PASSED**. ${"Every carton was intact. ".repeat(190)}`);
    expect(check(long)).toEqual([]);
    expect(check(long, { closing: "x".repeat(300) })).toEqual(["was longer than the summary's 5,000 characters"]);
    const longer = one(`The inspection concluded **PASSED**. ${"Every carton was intact. ".repeat(210)}`);
    expect(check(longer)).toEqual(["was longer than the summary's 5,000 characters"]);
  });
});

describe("unknownFigures", () => {
  it("compares by value: 2,900 is 2900, and 17% is not 17.1%", () => {
    expect(unknownFigures("2,900 cartons were 17% light.", ['{"cartons":2900,"deviation":"17.1%"}'])).toEqual(["17%"]);
    expect(unknownFigures("2.9 g against 2.90 g, AQL 0.0.", ["2.90", "0"])).toEqual([]);
  });

  it("allows figures from the note, the inspector's draft and the house wording, never from the examples alone", () => {
    const note = "The factory re-sorted 40 cartons.";
    const closing = "Valid for 30 days.";
    const example = "**PASSED.** 7 holes in 315 gloves.";
    const text = "40 cartons were re-sorted; 7 holes in 315 gloves. Valid for 30 days.";
    expect(unknownFigures(text, [LAB_INSPECTION_FACTS, note, closing])).toEqual(["7", "315"]);
    expect(unknownFigures(text, [LAB_INSPECTION_FACTS, note, closing, example])).toEqual([]);
  });

  it("leaves out the standards' own numbers, and lists each figure once, at most 5", () => {
    expect(unknownFigures("Under ISO 2859-1, EN 455 and ASTM D6319 the lot passed.", [])).toEqual([]);
    expect(unknownFigures("1 2 3 4 5 6 7 1", [])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("finds nothing unknown in the lab's answers against their inspection", () => {
    const plain = (answer: SummaryAnswer) =>
      summaryPlainText(answerToDoc(answer, { words: WORDS, emphasis: "result_and_issues", colourResult: false }).doc);
    expect(unknownFigures(plain(LAB_OPUS_PARAGRAPH_LIST), [LAB_INSPECTION_FACTS])).toEqual([]);
    expect(unknownFigures(plain(LAB_SONNET_HEADED), [LAB_INSPECTION_FACTS])).toEqual([]);
  });
});
