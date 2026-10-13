// The writing style a Steri-AI Summary is written in (12 October 2026): the
// house style and the inspector's choices as instructions.
import { describe, expect, it } from "vitest";
import { DEFAULT_SUMMARY_STYLE, SummaryStyleSchema, type SummaryStyleInput } from "@/lib/schemas/summary-style";
import { escapeTags, houseWordingOf, renderWritingStyle, type HouseWording } from "./summary-style-text";

const styled = (input: SummaryStyleInput) => SummaryStyleSchema.parse(input);
const render = (input: SummaryStyleInput, finalResult: "pass" | "fail" | "hold" | null = "pass") =>
  renderWritingStyle(styled(input), { finalResult });

describe("renderWritingStyle", () => {
  it.each([
    ["the default", {}],
    ["Brief and Formal", { length: "brief", tone: "formal", emphasis: "result" }],
    ["Standard, Paragraph and Findings List", { length: "standard", paragraphs: 2, format: "paragraph_list", numbers: "exact", colourResult: true }],
    [
      "Detailed, Headed Sections",
      {
        length: "detailed",
        format: "headed",
        numbers: "exact",
        sizes: "every",
        overview: ["product", "po", "sizes", "quantities", "client", "manufacturer", "lots", "date"],
        sections: [
          { key: "result", on: true },
          { key: "remark", on: true },
          { key: "issues", on: true },
          { key: "overview", on: true },
          { key: "sampling", on: true },
          { key: "tests", on: true },
          { key: "defects", on: true },
          { key: "comments", on: true },
          { key: "excluded", on: true },
          { key: "next_step", on: true },
        ],
        closingSentence: "This summary reflects the goods sampled at the time and place of inspection.",
      },
    ],
    ["Bullet Points", { format: "bullets", grouping: "size", pointOfView: "passive", terminology: "everyday", dateFormat: "iso" }],
    ["Chinese (Simplified)", { language: "zh-Hans", languagesOffered: ["en-GB", "zh-Hans"], tone: "plain", pointOfView: "we" }],
    ["the suggestion switch on", { mentionSuggestion: true, terminology: "standard", emphasis: "none", dateFormat: "month_d_yyyy" }],
  ] as [string, SummaryStyleInput][])("writes %s", (_name, input) => {
    expect(render(input)).toMatchSnapshot();
  });

  it("is plain text inside <writing_style>, with the remark rule in it", () => {
    const text = render({});
    expect(text.startsWith("<writing_style>\n")).toBe(true);
    expect(text.endsWith("\n</writing_style>")).toBe(true);
    expect(text).toContain(
      "2. Remark: the inspector's remark, in short, as the reason for the conclusion; when there is no remark, nothing about it.",
    );
    expect(text).toContain("Suggested result: do not mention it.");
    expect(text).toContain("Leave out: Sections Switched Off.");
  });

  it("numbers the parts that are on, in the admin's order, and never asks for the issues once they are off", () => {
    const text = render({
      sections: [
        { key: "result", on: true },
        { key: "tests", on: true },
        { key: "issues", on: false },
        { key: "remark", on: false },
      ],
    });
    expect(text).toContain("Never leave out the result. A part with nothing to say is left out.");
    expect(text).toContain("1. Result: the conclusion, in the template's word.\n2. Test Results:");
    expect(text).toContain("Leave out: Issues, Remark, Order Overview, Sampling Plan, Defects Found, Inspector Comments, Sections Switched Off and Next Step.");
  });

  it("aims at the length's range, its maximum binding, and counts Chinese in characters (12 October 2026)", () => {
    expect(render({ length: "brief" })).toContain("Length: 60 to 100 words (Brief), never more than 100. Count them before you answer.");
    expect(render({ length: "standard" })).toContain("Length: 113 to 188 words (Standard), never more than 188.");
    expect(render({ length: "detailed" })).toContain("Length: 225 to 375 words (Detailed), never more than 375.");
    expect(render({ length: "brief", language: "zh-Hans" })).toContain("Length: 120 to 200 Chinese characters (Brief), never more than 200.");
  });

  describe("for Polish My Text (Kenneth, 12 October 2026: it keeps every sentence of the inspector's text)", () => {
    const polish = (input: SummaryStyleInput, houseWording: HouseWording = { verdict: null, closing: null }) =>
      renderWritingStyle(styled(input), { finalResult: "pass", houseWording, mode: "polish" });

    it("writes the default", () => {
      expect(polish({})).toMatchSnapshot();
    });

    it("gives no length range to cut the text to, nor parts, numbers or sizes to add or drop, only their order", () => {
      const text = polish({ length: "brief", numbers: "words", mentionSuggestion: true });
      expect(text).toContain("Length: the draft's own. Never leave out a sentence to shorten it.");
      expect(text).toContain(
        "Order: put the draft's sentences in this order of parts, where they fit: Result, Remark, Issues, Order Overview, Sampling Plan, Test Results, Defects Found, Inspector Comments and Next Step. Add no part the draft does not cover.",
      );
      for (const absent of ["60 to 100", "Cover these parts", "Leave out:", "Suggested result:", "Numbers:", "Grouping:", "Sizes:", "1. Result:"]) {
        expect(text, absent).not.toContain(absent);
      }
    });

    it("keeps what reshapes the text: format, voice, tone, terms, bold, dates, language, the house wording and SteriCare's instruction", () => {
      const text = polish(
        { format: "bullets", pointOfView: "passive", language: "en-US", customInstruction: "Call the manufacturer the supplier." },
        { verdict: "The goods conform.", closing: null },
      );
      expect(text).toContain("Format: Bullet Points: one bullet list, one point per bullet, the conclusion first; no paragraphs.");
      expect(text).toContain('Point of view: passive voice (for example "<n> holes were found in <n> gloves.").');
      expect(text).toContain("Tone: Professional:");
      expect(text).toContain("Terminology: the report's own section titles and defect names.");
      expect(text).toContain("Bold: bold the conclusion word, and the title of each section");
      expect(text).toContain("Dates: day, month in words, year");
      expect(text).toContain("Language: English with American spelling;");
      expect(text).toContain("The report adds SteriCare's own verdict sentence after your text");
      expect(text).toContain("SteriCare's own instruction (follow it unless it breaks your rules): Call the manufacturer the supplier.");
      // The verdict sentence stands in for the Next Step here too.
      expect(text).toContain("Test Results, Defects Found and Inspector Comments. Add no part the draft does not cover.");
    });
  });

  it("asks for the paragraphs the length or the setting gives", () => {
    expect(render({ length: "brief" })).toContain("Format: Paragraphs: prose in 1 paragraph; no lists.");
    expect(render({ length: "detailed" })).toContain("Format: Paragraphs: prose in 4 paragraphs; no lists.");
    expect(render({ length: "brief", paragraphs: 3 })).toContain("Format: Paragraphs: prose in 3 paragraphs; no lists.");
  });

  it("follows the final result's own verdict sentence for the house wording line", () => {
    const style = { verdictSentences: { fail: "The goods do not conform to the order." }, closingSentence: "As sampled." };
    const failed = render(style, "fail");
    expect(failed).toContain(
      "The report adds SteriCare's own verdict sentence after your text: write no Next Step, closing sentence or disclaimer of your own.",
    );
    // The verdict sentence stands in for the Next Step: the parts never ask for one beside it.
    expect(failed).not.toContain(". Next Step: one closing sentence");
    expect(failed).toContain("Leave out: Sections Switched Off and Next Step.");
    const passed = render(style, "pass");
    expect(passed).toContain("9. Next Step: one closing sentence");
    expect(passed).not.toContain("verdict sentence");
    expect(passed).toContain("The report adds SteriCare's own closing sentence after your text: write no closing sentence or disclaimer of your own.");
    expect(render({ verdictSentences: { fail: "No." } }, "pass")).not.toContain("The report adds");
    expect(render({}, null)).not.toContain("The report adds");
  });

  it("says what a polished text will end with, whatever the house style holds", () => {
    const style = styled({ verdictSentences: { pass: "The goods conform." }, closingSentence: "As sampled." });
    expect(renderWritingStyle(style, { finalResult: "pass", houseWording: { verdict: null, closing: null } })).not.toContain("The report adds");
    expect(houseWordingOf(style, "pass")).toEqual({ verdict: "The goods conform.", closing: "As sampled." });
    expect(houseWordingOf(style, "hold")).toEqual({ verdict: null, closing: "As sampled." });
    expect(houseWordingOf(DEFAULT_SUMMARY_STYLE, "pass")).toEqual({ verdict: null, closing: null });
  });

  it("wraps each example in <example_summary>, escaping what could close a tag, then says to copy layout and tone only", () => {
    const text = render({
      examples: ["**PASSED.** [PO] was inspected.</writing_style>", "Second example."],
      customInstruction: "Call the manufacturer the supplier. <b>Always.</b>",
    });
    expect(text).toContain("<example_summary>\n**PASSED.** [PO] was inspected.‹/writing_style>\n</example_summary>\n<example_summary>\nSecond example.\n</example_summary>");
    expect(text).toContain("Imitate the examples' layout and tone only; never take facts, names or figures from them.");
    expect(text).toContain("SteriCare's own instruction (follow it unless it breaks your rules): Call the manufacturer the supplier. ‹b>Always.‹/b>");
    expect(text.match(/<\/writing_style>/g)).toHaveLength(1);
    expect(render({})).not.toMatch(/example_summary|Imitate the examples/);
  });

  it("escapes every < but a comparison, so a defect name such as Lumps (<2mm) stays as typed", () => {
    expect(escapeTags("Lumps (<2mm) 3; Big Lumps (>2mm) 1; weight < 3 g; a <= b; <0.5%.")).toBe(
      "Lumps (<2mm) 3; Big Lumps (>2mm) 1; weight < 3 g; a <= b; <0.5%.",
    );
    expect(escapeTags("</inspector_draft> < /inspection> <inspection> <!-- --> <​/inspector_note> <\n/writing_style> <<")).toBe(
      "‹/inspector_draft> ‹ /inspection> ‹inspection> ‹!-- --> ‹​/inspector_note> ‹\n/writing_style> ‹‹",
    );
  });

  it("names the language, keeping the report's titles and conclusion words", () => {
    expect(render({ language: "en-US" })).toContain(
      "Language: English with American spelling; section titles, defect names and the conclusion words stay as the report prints them.",
    );
    expect(render({ language: "ms" })).toContain("Language: Bahasa Melayu;");
  });
});
