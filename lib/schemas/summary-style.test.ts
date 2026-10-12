// The Steri-AI Summary's house style (12 October 2026): the defaults the
// settings card shows, Title Case labels, what an inspector's menu may
// change, and how a stored style from another build still reads.
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import {
  countSummaryWords,
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_STYLE,
  needsResultMessage,
  paragraphTarget,
  resolveSummaryStyle,
  stepLength,
  SUMMARY_DATE_FORMATS,
  SUMMARY_EMPHASIS,
  SUMMARY_FIELDS,
  SUMMARY_FORMATS,
  SUMMARY_GROUPING,
  SUMMARY_LANGUAGES,
  SUMMARY_LENGTHS,
  SUMMARY_MENU_TEXT,
  SUMMARY_NUMBERS,
  SUMMARY_OVERVIEW_DETAILS,
  SUMMARY_PARAGRAPHS,
  SUMMARY_POINTS_OF_VIEW,
  SUMMARY_SECTIONS,
  SUMMARY_SIZES,
  SUMMARY_TERMINOLOGY,
  SUMMARY_TONES,
  SUMMARY_VERDICT_FIELDS,
  summaryLengthRange,
  summaryMenuOf,
  SummaryOptionsSchema,
  SummaryPreviewInputSchema,
  SummarySettingsInputSchema,
  SummaryStyleSchema,
  type SummaryStyle,
} from "./summary-style";

const style = (input: Record<string, unknown>): SummaryStyle => SummaryStyleSchema.parse(input);
const issuesOf = (input: Record<string, unknown>) => {
  const parsed = SummaryStyleSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
};

describe("the house style's defaults", () => {
  it("match the settings card", () => {
    expect(DEFAULT_SUMMARY_MODEL).toBe("claude-sonnet-5-5");
    expect(DEFAULT_SUMMARY_STYLE).toEqual({
      length: "standard",
      paragraphs: "auto",
      format: "paragraphs",
      numbers: "key",
      sections: [
        { key: "result", on: true },
        { key: "remark", on: true },
        { key: "issues", on: true },
        { key: "overview", on: true },
        { key: "sampling", on: true },
        { key: "tests", on: true },
        { key: "defects", on: true },
        { key: "comments", on: true },
        { key: "excluded", on: false },
        { key: "next_step", on: true },
      ],
      overview: ["product", "po", "sizes", "quantities"],
      inspectorsCanAdjust: true,
      grouping: "test",
      sizes: "differences",
      mentionSuggestion: false,
      pointOfView: "third_person",
      tone: "professional",
      terminology: "template",
      emphasis: "result_and_issues",
      colourResult: false,
      dateFormat: "d_month_yyyy",
      language: "en-GB",
      languagesOffered: ["en-GB"],
      verdictSentences: { pass: "", fail: "", hold: "" },
      closingSentence: "",
      customInstruction: "",
      examples: [],
    });
  });

  it("parse the same twice, and a parse never shares the default's arrays", () => {
    const first = style({});
    first.sections[1].on = false;
    first.languagesOffered.push("ms");
    expect(style({})).toEqual(DEFAULT_SUMMARY_STYLE);
    expect(SummaryStyleSchema.parse(DEFAULT_SUMMARY_STYLE)).toEqual(DEFAULT_SUMMARY_STYLE);
  });
});

describe("the labels", () => {
  it("are in Title Case (docs/DESIGN.md)", () => {
    const labels = [
      ...[SUMMARY_LENGTHS, SUMMARY_PARAGRAPHS, SUMMARY_FORMATS, SUMMARY_NUMBERS, SUMMARY_GROUPING, SUMMARY_SIZES].flatMap((list) =>
        list.map((choice) => choice.label),
      ),
      ...[SUMMARY_POINTS_OF_VIEW, SUMMARY_TONES, SUMMARY_TERMINOLOGY, SUMMARY_EMPHASIS, SUMMARY_DATE_FORMATS, SUMMARY_LANGUAGES].flatMap(
        (list) => list.map((choice) => choice.label),
      ),
      ...SUMMARY_LENGTHS.map((length) => length.shortLabel),
      ...SUMMARY_SECTIONS.map((section) => section.label),
      ...SUMMARY_OVERVIEW_DETAILS.map((detail) => detail.label),
      ...SUMMARY_VERDICT_FIELDS.map((field) => field.label),
      ...Object.values(SUMMARY_FIELDS).map((field) => field.label),
      SUMMARY_MENU_TEXT.note.label,
      SUMMARY_MENU_TEXT.polish.label,
    ];
    expect(labels.filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
  });

  it("give each section and each format a hint", () => {
    expect(SUMMARY_SECTIONS.every((section) => section.hint.endsWith("."))).toBe(true);
    expect(SUMMARY_FORMATS.every((format) => format.hint.endsWith("."))).toBe(true);
    expect(SUMMARY_NUMBERS.every((numbers) => numbers.hint.endsWith("."))).toBe(true);
  });
});

describe("resolveSummaryStyle", () => {
  const offered = style({ languagesOffered: ["en-GB", "ms"] });

  it("applies the inspector's length, paragraphs, format and an offered language while inspectors can adjust", () => {
    expect(resolveSummaryStyle(offered, { length: "brief", paragraphs: 1, format: "bullets", language: "ms" })).toMatchObject({
      length: "brief",
      paragraphs: 1,
      format: "bullets",
      language: "ms",
    });
  });

  it("keeps the house language when the one asked for is not offered", () => {
    expect(resolveSummaryStyle(offered, { language: "zh-Hans" }).language).toBe("en-GB");
    expect(resolveSummaryStyle(DEFAULT_SUMMARY_STYLE, { language: "ms" }).language).toBe("en-GB");
  });

  it("keeps the house style for anything left out", () => {
    expect(resolveSummaryStyle(offered, {})).toEqual(offered);
  });

  it("applies nothing from the menu while the admin has locked it, the language included", () => {
    const locked = style({ inspectorsCanAdjust: false, languagesOffered: ["en-GB", "ms"] });
    expect(resolveSummaryStyle(locked, { length: "detailed", paragraphs: 5, format: "headed", language: "ms" })).toEqual(locked);
  });

  it("never changes what the menu does not offer", () => {
    const house = style({ tone: "formal", numbers: "exact", colourResult: true });
    const resolved = resolveSummaryStyle(house, { length: "brief" });
    expect(resolved).toMatchObject({ tone: "formal", numbers: "exact", colourResult: true, length: "brief" });
  });
});

describe("lengths and paragraphs", () => {
  it("asks for the length's own paragraphs on Auto, else the setting", () => {
    expect(paragraphTarget({ length: "brief", paragraphs: "auto" })).toBe(1);
    expect(paragraphTarget({ length: "standard", paragraphs: "auto" })).toBe(2);
    expect(paragraphTarget({ length: "detailed", paragraphs: "auto" })).toBe(4);
    expect(paragraphTarget({ length: "brief", paragraphs: 3 })).toBe(3);
  });

  it("steps one length at a time and stops at both ends", () => {
    expect(stepLength("standard", -1)).toBe("brief");
    expect(stepLength("standard", 1)).toBe("detailed");
    expect(stepLength("brief", -1)).toBe("brief");
    expect(stepLength("detailed", 1)).toBe("detailed");
  });

  it("aims a quarter either side, in Chinese characters at twice the numbers", () => {
    expect(summaryLengthRange("brief", "en-GB")).toEqual({ lo: 60, hi: 100, unit: "words" });
    expect(summaryLengthRange("standard", "en-US")).toEqual({ lo: 113, hi: 188, unit: "words" });
    expect(summaryLengthRange("detailed", "ms")).toEqual({ lo: 225, hi: 375, unit: "words" });
    expect(summaryLengthRange("brief", "zh-Hans")).toEqual({ lo: 120, hi: 200, unit: "characters" });
  });

  it("counts words, and characters for Chinese", () => {
    expect(countSummaryWords("The inspection concluded PASSED.\n\n• Weight passed with 2.9 g.", "en-GB")).toBe(9);
    expect(countSummaryWords("检验结论为 PASSED。", "zh-Hans")).toBe(12);
  });
});

describe("the sections", () => {
  it("append a part added later switched off, and drop a part this build does not know", () => {
    const parsed = style({
      sections: [
        { key: "result", on: true },
        { key: "issues", on: true },
        { key: "tests", on: false },
        { key: "deviation", on: true },
      ],
    });
    expect(parsed.sections).toEqual([
      { key: "result", on: true },
      { key: "issues", on: true },
      { key: "tests", on: false },
      { key: "remark", on: false },
      { key: "overview", on: false },
      { key: "sampling", on: false },
      { key: "defects", on: false },
      { key: "comments", on: false },
      { key: "excluded", on: false },
      { key: "next_step", on: false },
    ]);
  });

  it("put Result first and on, wherever it was sent", () => {
    const parsed = style({
      sections: [
        { key: "issues", on: true },
        { key: "result", on: false },
      ],
    });
    expect(parsed.sections.slice(0, 2)).toEqual([
      { key: "result", on: true },
      { key: "issues", on: true },
    ]);
  });

  it("refuse a part listed twice", () => {
    expect(
      issuesOf({
        sections: [
          { key: "result", on: true },
          { key: "issues", on: true },
          { key: "issues", on: false },
        ],
      }),
    ).toEqual([{ path: "sections.2.key", message: "List each part once." }]);
  });

  it("keep the overview's details in their own order, without one this build does not know", () => {
    expect(style({ overview: ["lots", "product", "colour", "product"] }).overview).toEqual(["product", "lots"]);
  });
});

describe("the stored style", () => {
  it("still reads with a key another build saved, and takes the default of one added later", () => {
    const parsed = style({ length: "brief", retired: true, mentionSuggestion: undefined });
    expect(parsed).not.toHaveProperty("retired");
    expect(parsed).toMatchObject({ length: "brief", mentionSuggestion: false });
  });

  it("always offers the house language, in the list's order", () => {
    expect(style({ language: "ms", languagesOffered: ["zh-Hans", "en-GB"] }).languagesOffered).toEqual(["en-GB", "ms", "zh-Hans"]);
    expect(style({ language: "en-US", languagesOffered: [] }).languagesOffered).toEqual(["en-US"]);
  });

  it("offers only English (UK and US), Bahasa Melayu and Chinese (Simplified)", () => {
    expect(SUMMARY_LANGUAGES.map((language) => language.value)).toEqual(["en-GB", "en-US", "ms", "zh-Hans"]);
    expect(issuesOf({ language: "ja" })).toEqual([{ path: "language", message: "Choose a language." }]);
  });

  it("trims the house wording and drops a blank example", () => {
    const parsed = style({
      verdictSentences: { pass: "  The lot conforms.  " },
      closingSentence: " As sampled. ",
      examples: ["  ", "**PASSED.** [PO] was inspected."],
    });
    expect(parsed.verdictSentences).toEqual({ pass: "The lot conforms.", fail: "", hold: "" });
    expect(parsed.closingSentence).toBe("As sampled.");
    expect(parsed.examples).toEqual(["**PASSED.** [PO] was inspected."]);
  });
});

describe("the limits", () => {
  it("keep each house sentence to 300 characters", () => {
    expect(issuesOf({ closingSentence: "x".repeat(300), verdictSentences: { hold: "x".repeat(300) } })).toEqual([]);
    expect(issuesOf({ closingSentence: "x".repeat(301), verdictSentences: { fail: "x".repeat(301) } })).toEqual([
      { path: "verdictSentences.fail", message: "Keep a sentence to 300 characters." },
      { path: "closingSentence", message: "Keep a sentence to 300 characters." },
    ]);
  });

  it("keep the instruction to 500 characters and an example to 1,500, with at most 2 examples", () => {
    expect(issuesOf({ customInstruction: "x".repeat(500), examples: ["x".repeat(1500), "y"] })).toEqual([]);
    expect(issuesOf({ customInstruction: "x".repeat(501) })).toEqual([
      { path: "customInstruction", message: "Keep the instruction to 500 characters." },
    ]);
    expect(issuesOf({ examples: ["x".repeat(1501)] })).toEqual([{ path: "examples.0", message: "Keep an example to 1,500 characters." }]);
    expect(issuesOf({ examples: ["a", "b", "c"] })).toEqual([{ path: "examples", message: "Add up to 2 examples." }]);
  });

  it("refuse text Postgres cannot store: a NUL or half an emoji", () => {
    expect(issuesOf({ closingSentence: "As sampled 😀." })).toEqual([]);
    expect(issuesOf({ closingSentence: "As sampled \ud83d." })).toEqual([
      { path: "closingSentence", message: "This text holds a character that cannot be saved." },
    ]);
    expect(issuesOf({ customInstruction: "Call it\u0000" })).toHaveLength(1);
  });

  it("keep the note for one summary to 300 characters, trimmed", () => {
    expect(SummaryOptionsSchema.parse({ mode: "write", note: "  The factory agreed to re-sort size M.  " })).toEqual({
      mode: "write",
      note: "The factory agreed to re-sort size M.",
    });
    expect(SummaryOptionsSchema.safeParse({ mode: "write", note: "x".repeat(301) }).success).toBe(false);
  });
});

describe("one summary's options", () => {
  it("take write or polish and the menu's choices, nothing else", () => {
    expect(SummaryOptionsSchema.parse({ mode: "polish", length: "detailed", paragraphs: "auto", format: "headed", language: "en-US" })).toEqual({
      mode: "polish",
      length: "detailed",
      paragraphs: "auto",
      format: "headed",
      language: "en-US",
      note: "",
    });
    for (const options of [{ mode: "shorter" }, { mode: "write", paragraphs: 6 }, { mode: "write", paragraphs: "2" }, { mode: "write", tone: "formal" }]) {
      expect(SummaryOptionsSchema.safeParse(options).success, JSON.stringify(options)).toBe(false);
    }
  });
});

describe("the settings card's inputs", () => {
  it("take a Claude model id and a style", () => {
    expect(SummarySettingsInputSchema.parse({ model: "claude-opus-5-5", style: {} })).toEqual({
      model: "claude-opus-5-5",
      style: DEFAULT_SUMMARY_STYLE,
    });
    const refused = SummarySettingsInputSchema.safeParse({ model: "gpt-5", style: { tone: "loud" } });
    expect(refused.success ? [] : refused.error.issues.map((issue) => issue.path.join("."))).toEqual(["model", "style.tone"]);
  });

  it("take Try It's inspection, model and style, nothing else", () => {
    const input = { inspectionId: "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e", model: "claude-haiku-5-5", style: {} };
    expect(SummaryPreviewInputSchema.parse(input)).toEqual({ ...input, style: DEFAULT_SUMMARY_STYLE });
    expect(SummaryPreviewInputSchema.safeParse({ ...input, inspectionId: "INS-2026-2192" }).success).toBe(false);
    expect(SummaryPreviewInputSchema.safeParse({ ...input, extra: 1 }).success).toBe(false);
  });
});

describe("the menu beside the button", () => {
  it("offers the house style's choices and whether inspectors may change them", () => {
    const menu = summaryMenuOf(style({ length: "brief", format: "bullets", languagesOffered: ["en-GB", "zh-Hans"], inspectorsCanAdjust: false }));
    expect(menu).toEqual({
      length: "brief",
      paragraphs: "auto",
      format: "bullets",
      language: "en-GB",
      languagesOffered: ["en-GB", "zh-Hans"],
      inspectorsCanAdjust: false,
    });
  });

  it("asks for the conclusion in the template's words", () => {
    expect(needsResultMessage({ pass: "PASSED", fail: "FAILED", hold: "HOLD" })).toBe(
      "Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion.",
    );
    expect(needsResultMessage({ pass: "ACCEPTED", fail: "REJECTED", hold: "ON HOLD" })).toBe(
      "Choose ACCEPTED, REJECTED or ON HOLD first: the summary starts with the conclusion.",
    );
  });
});
