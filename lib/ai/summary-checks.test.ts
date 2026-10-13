// The checks a Steri-AI Summary draft passes before an inspector sees it (12
// October 2026), on the prompt lab's answers among others.
import { describe, expect, it } from "vitest";
import type { InspectionResult } from "@/lib/schemas/common";
import { LAB_CALL_3, LAB_INSPECTION_FACTS, LAB_OPUS_PARAGRAPH_LIST, LAB_SONNET_HEADED } from "./__fixtures__/summary-answers";
import {
  droppedFromDraft,
  FORBIDDEN_TERMS,
  hardCheckProblems,
  isUnwantedNote,
  lengthNote,
  overLength,
  practicalNotes,
  tooLongProblem,
  unknownFigures,
  type HardCheckInput,
} from "./summary-checks";
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

describe("Polish My Text keeps every sentence and figure of the inspector's text (Kenneth, 12 October 2026)", () => {
  // As docToInlineText sends it: paragraphs apart, **bold**, list points as "- " lines.
  const DRAFT = [
    "Inspection **PASSED**. Checked on site.",
    "Weight 2.90 g for size M, 17.1% under the indicative 3.5 g.",
    "- Watertight: 1 hole in 500 gloves.\n- Visual: 8 major defects in 500, accept 21, reject 22.",
  ].join("\n\n");
  const KEPT = [
    "The inspection concluded PASSED, checked on site.",
    "Weight averaged 2.90 g for size M, 17.1% below the indicative 3.5 g.",
    "• The watertight test found 1 hole in 500 gloves.\n• Visual Inspection found 8 major defects in 500 gloves, against accept 21, reject 22.",
  ].join("\n\n");

  it("lets a polish reword, merge and reorder the sentences", () => {
    expect(droppedFromDraft(DRAFT, KEPT, "en-GB")).toEqual({ sentences: [], figures: [] });
    const reordered = [
      "Visual Inspection found 8 major defects in 500 gloves (accept 21, reject 22), and the watertight test 1 hole in 500 gloves.",
      "The inspection concluded PASSED. It was checked on site.",
      "Weight averaged 2.90 g for size M, 17.1% below the indicative 3.5 g.",
    ].join("\n\n");
    expect(droppedFromDraft(DRAFT, reordered, "en-GB")).toEqual({ sentences: [], figures: [] });
  });

  it("lets it write shortforms in full and drop fillers", () => {
    const rough = "WTT passed. FAB median 6.5 N ok. SKV 3 pcs, FM 2 pcs. Overall OK lah.";
    const polished =
      "The watertight test passed. Force at Break passed with a median of 6.5 N. Visual Inspection found 3 gloves with Skin Visual and 2 with Flow Mark. Overall, the goods were acceptable.";
    expect(droppedFromDraft(rough, polished, "en-GB")).toEqual({ sentences: [], figures: [] });
  });

  it("lets it mend the inspector's spelling and write their shorthand in full, as a polish should", () => {
    const rough = "Inspection passed. chked onsite. Insp done at fty. Lables corect. Pinhole at fingertip. The watertight test found 1 hole in 500 gloves.";
    const polished =
      "The inspection PASSED. It was checked on site. The inspection was done at the factory. The labels were correct. The watertight test found 1 hole in 500 gloves, at the Finger Tip.";
    expect(droppedFromDraft(rough, polished, "en-GB")).toEqual({ sentences: [], figures: [] });
    // Still found when it goes.
    expect(droppedFromDraft(rough, polished.replace(" It was checked on site.", ""), "en-GB").sentences).toEqual(["chked onsite."]);
  });

  it("never asks it to keep what a summary never says", () => {
    const draft = "All modules passed. Checked on site. The watertight test found 1 hole in 500 gloves.";
    const polished = "All sections passed. The inspection was checked on site. The watertight test found 1 hole in 500 gloves.";
    expect(droppedFromDraft(draft, polished, "en-GB")).toEqual({ sentences: [], figures: [] });
  });

  it("finds the sentence the reviewers' polish took out, as it is not a recorded fact", () => {
    const dropped = KEPT.replace(", checked on site.", ".");
    expect(droppedFromDraft(DRAFT, dropped, "en-GB")).toEqual({ sentences: ["Checked on site."], figures: [] });
  });

  it("does not take a word met elsewhere for the sentence: its words must stand together", () => {
    // "check" is in Glove Packing Check, "site" in the packing site; neither keeps "Checked on site." alone.
    const elsewhere = `${KEPT.replace(", checked on site.", ".")}\n\nThe Glove Packing Check passed. Factory A1 was the packing site.`;
    expect(droppedFromDraft(DRAFT, elsewhere, "en-GB").sentences).toEqual(["Checked on site."]);
  });

  it("finds a figure the polish changed or left out, and lets dates in figures be written in words", () => {
    const changed = KEPT.replace("17.1% below", "17% below").replace(", against accept 21, reject 22", "");
    expect(droppedFromDraft(DRAFT, changed, "en-GB").figures).toEqual(["17.1%", "21", "22"]);
    const dated = "Inspected on 09/10/2026 at the factory; 2,900 cartons.";
    expect(droppedFromDraft(dated, "Inspected on 9 October 2026 at the factory; 2900 cartons.", "en-GB")).toEqual({
      sentences: [],
      figures: [],
    });
    // List numbers are no figures, on either side.
    expect(droppedFromDraft("1. Weight passed with a warning.\n2. Labels passed.", "Weight passed with a warning. Labels passed.", "en-GB")).toEqual({
      sentences: [],
      figures: [],
    });
  });

  it("compares only the figures of a translated polish or a Chinese one", () => {
    const malay = "Pemeriksaan **PASSED**. Berat 2.90 g untuk saiz M, 17.1% di bawah 3.5 g. Diperiksa di tapak.";
    expect(droppedFromDraft(DRAFT, malay, "ms")).toEqual({ sentences: [], figures: ["1", "500", "8", "21", "22"] });
    expect(droppedFromDraft("Checked on site. Weight 2.90 g.", "现场检查。重量 2.90 g。", "zh-Hans")).toEqual({ sentences: [], figures: [] });
    // In Bahasa Melayu the report's titles stay in English, which never makes a translation the draft's words.
    const titled = "Pemeriksaan **PASSED**. Watertight Test tidak menemui lubang dalam 500 sarung tangan. Visual Inspection menemui 8 Major Defects.";
    expect(droppedFromDraft("Inspection PASSED. The watertight test found no holes in 500 gloves. Visual found 8 major defects.", titled, "ms")).toEqual({
      sentences: [],
      figures: [],
    });
    // Nor a draft in Bahasa Melayu, polished into English with the titles it kept.
    const draft = "Pemeriksaan PASSED. Watertight Test tiada lubang dalam 500 sarung tangan. Diperiksa di kilang.";
    const english = "The inspection PASSED. The Watertight Test found no holes in 500 gloves. The inspection was done at the factory.";
    expect(droppedFromDraft(draft, english, "en-GB")).toEqual({ sentences: [], figures: [] });
  });

  it("on the prompt lab's real polish (13 October 2026, Claude Sonnet 5.5, the placeholder STD_EG draft): asks for the sentence reworded away, takes the retry", () => {
    const inspectorText = [
      "Inspection **PASSED**. Checked on site.",
      "Weight for size M averaged 2.90 g, 17.1% under the indicative 3.5 g, so weight passed with a warning.",
      "The watertight test found no holes. Visual found 8 major defects in 500 gloves, under the reject number.",
    ].join("\n\n");
    const tail =
      "The **Weight (g) - Average of 13 Gloves per Size** section passed with a warning: the average weight for size M was 2.90 g, which is 17.1% below the indicative 3.5 g.\n\nThe Freedom From Holes by Watertight Test found no holes. The Visual Inspection found 8 major defects in 500 gloves, which is below the reject number.";
    // Strict on a sentence of two telling words: "carried out on site" keeps "site" only, so it is asked for once more.
    expect(droppedFromDraft(inspectorText, `The inspection result was **PASSED**. The inspection was carried out on site. ${tail}`, "en-GB")).toEqual({
      sentences: ["Checked on site."],
      figures: [],
    });
    expect(droppedFromDraft(inspectorText, `The inspection result was **PASSED**. The inspection was checked on site. ${tail}`, "en-GB")).toEqual({
      sentences: [],
      figures: [],
    });
  });

  it("asks once more, quoting what went, and never checks a written summary this way", () => {
    const dropped = KEPT.replace(", checked on site.", ".").replace("17.1% below", "17% below");
    const answer: SummaryAnswer = { blocks: [{ type: "paragraph", items: dropped.split("\n\n").map((text) => text.replaceAll("\n", " ")) }], notes: [] };
    expect(check(answer, { mode: "polish", draft: DRAFT })).toEqual([
      'left out the inspector\'s sentence "Checked on site" and the inspector\'s figure 17.1%: a polish keeps every sentence and figure of the draft, in or close to the inspector\'s words',
    ]);
    expect(check(one(KEPT.replaceAll("\n", " ")), { mode: "polish", draft: DRAFT })).toEqual([]);
    expect(check(answer, { mode: "write", draft: DRAFT })).toEqual([]);
  });
});

describe("the length (Kenneth, 12 October 2026: a Standard draft ran to 249 words against 113 to 188)", () => {
  const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

  it("is over only past the maximum plus 15%, counting Steri-AI's own text", () => {
    expect(overLength(words(216), { length: "standard", language: "en-GB" })).toBeNull();
    expect(overLength(words(217), { length: "standard", language: "en-GB" })).toEqual({ words: 217, max: 188, unit: "words" });
    expect(overLength(words(115), { length: "brief", language: "en-GB" })).toBeNull();
    expect(overLength(words(116), { length: "brief", language: "en-US" })).toEqual({ words: 116, max: 100, unit: "words" });
    expect(overLength("字".repeat(231), { length: "brief", language: "zh-Hans" })).toEqual({ words: 231, max: 200, unit: "characters" });
  });

  it("takes the prompt lab's Standard draft (13 October 2026): 202 words, over 188 but within 216", () => {
    const draft = [
      "The inspection concluded PASSED. One section passed with a warning: Weight (g) - Average of 13 Gloves per Size found an average of 2.90 g for size M, which is 17.1% below the indicative 3.5 g and beyond the 10% threshold. The inspector noted that the gloves were weighed on the factory scale and that the indicative weight comes from the glove spec sheet. The inspection covered Brand A PC-A01 Blue Nitrile examination gloves under PO-0001, size M only, 2,900 cartons and 5,800,000 gloves.",
      "The inspection followed EN 455 with inspection level I, code letter N and a sample of 500 gloves from 50 cartons. Carton numbers were unique and within range. Dimension passed, and Force at Break had a median of 6.537 N against a minimum of 6 N. The watertight test (AQL 1.5) found 1 hole in 500 gloves, on a finger, against accept 14, reject 15. Visual Inspection found 0 Critical Defects, 8 Major Defects (accept 21, reject 22) and 0 Minor Defects. The Major Defects were 5 Thin Spot on Glove Body, 2 Thin Area Between Fingers (Crotch) and 1 Thin Area on Glove Body. Glove Packing Check and Packaging Labeling Inspection passed. The lot is concluded as PASSED.",
    ].join("\n\n");
    expect(overLength(draft, { length: "standard", language: "en-GB" })).toBeNull();
    expect(overLength(draft, { length: "brief", language: "en-GB" })).toEqual({ words: 202, max: 100, unit: "words" });
  });

  it("says by how much in the retry, and what to do in the note", () => {
    expect(tooLongProblem({ words: 249, max: 188, unit: "words" })).toBe(
      "was too long by 61 words (249; 188 at most): shorten the later parts first, then leave them out",
    );
    expect(lengthNote({ length: "standard", language: "en-GB" })).toBe("Shorten the summary to 188 words at most (Standard).");
    expect(lengthNote({ length: "brief", language: "zh-Hans" })).toBe("Shorten the summary to 200 Chinese characters at most (Brief).");
  });
});

describe("the notes: short, impersonal and practical (Kenneth, 12 October 2026)", () => {
  it.each([
    "I removed it as it is not a recorded fact.",
    "I've kept the inspector's wording.",
    "We could not find the weight.",
    "Let us know the reason.",
    "The data does not record a remark.",
    "Weight is missing from the inspection data.",
    "The inspection is still a draft.",
    "This inspection remains in draft status.",
    "The inspection was reopened, so results may change.",
    "The inspection has not been submitted yet.",
  ])("drops %j", (note) => {
    expect(isUnwantedNote(note)).toBe(true);
  });

  it.each([
    "Add the reason under Remark.",
    "Weight passed with a warning: correct the summary.",
    // The prompt lab's (13 October 2026): "the draft" is the inspector's text here, no status.
    "The draft says the watertight test found no holes, but the report records 1 hole (Finger) in 500 gloves: correct the summary.",
    "The draft says 13 gloves were weighed; the Sampling Plan gives 12.",
    "Sampling at inspection level I gives code letter N: check the lot size.",
    "Record the US lot number under Lot Number.",
    "Record the weight for size M before signing.",
    // A document not submitted is a gap to fix, not the inspection's status.
    "The tensile lab report was not submitted: add it on Source Documents.",
  ])("keeps %j", (note) => {
    expect(isUnwantedNote(note)).toBe(false);
  });

  it("keeps the practical ones, in their order", () => {
    expect(practicalNotes(["I removed a sentence.", "Add the reason under Remark.", "The data shows no photos.", "Record the weight of size M."])).toEqual([
      "Add the reason under Remark.",
      "Record the weight of size M.",
    ]);
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
