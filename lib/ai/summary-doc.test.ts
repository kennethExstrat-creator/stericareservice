// Steri-AI's flat answer as the Inspection Summary's own document (12
// October 2026): bold, stray marks, colour, house wording, and the
// document the field itself accepts.
import { describe, expect, it } from "vitest";
import { toRichTextDoc } from "@/lib/rich-text";
import { RichTextDocSchema, type RichTextDoc } from "@/lib/schemas/rich-text";
import { LAB_OPUS_PARAGRAPH_LIST, LAB_SONNET_HEADED } from "./__fixtures__/summary-answers";
import {
  answerToDoc,
  appendHouseWording,
  docToInlineText,
  parseSummaryAnswer,
  RESULT_COLOURS,
  stripHouseWording,
  SUMMARY_OUTPUT_SCHEMA,
  SummaryAnswerSchema,
  summaryPlainText,
  type SummaryAnswer,
  type SummaryDocOptions,
} from "./summary-doc";

const WORDS = { pass: "PASSED", fail: "FAILED", hold: "HOLD" };
const OPTIONS: SummaryDocOptions = { words: WORDS, emphasis: "result_and_issues", colourResult: false };

const answer = (blocks: SummaryAnswer["blocks"], notes: string[] = []): SummaryAnswer => ({ blocks, notes });
const paragraph = (...items: string[]): SummaryAnswer["blocks"][number] => ({ type: "paragraph", items });
const docOf = (value: SummaryAnswer, options: Partial<SummaryDocOptions> = {}) => answerToDoc(value, { ...OPTIONS, ...options });

/** Valid for the field, in the editor's canonical form, and with no list inside a list. */
function expectFieldDocument(doc: RichTextDoc) {
  expect(RichTextDocSchema.safeParse(doc).success).toBe(true);
  expect(toRichTextDoc(doc)).toEqual(doc);
  for (const block of doc.content) {
    if (block.type === "paragraph") continue;
    for (const item of block.content) expect(item.content.map((child) => child.type)).toEqual(["paragraph"]);
  }
}

describe("the output contract", () => {
  it("is flat and strict: blocks of strings, and notes", () => {
    expect(SUMMARY_OUTPUT_SCHEMA.required).toEqual(["blocks", "notes"]);
    expect(SUMMARY_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(SUMMARY_OUTPUT_SCHEMA.properties.blocks.items.properties.items.items).toEqual({ type: "string" });
    expect(JSON.stringify(SUMMARY_OUTPUT_SCHEMA)).not.toMatch(/minItems|maxItems|maxLength|\$ref/);
  });

  it("reads an answer, trimming the notes to 3 of 300 characters", () => {
    const read = parseSummaryAnswer(
      JSON.stringify({ blocks: [paragraph("The lot **PASSED**.")], notes: ["  One.  ", "", "Two.", "Three.", "Four.", "x".repeat(400)] }),
    );
    expect(read).toEqual({ ok: true, answer: { blocks: [paragraph("The lot **PASSED**.")], notes: ["One.", "Two.", "Three."] } });
    expect(SummaryAnswerSchema.parse({ blocks: [paragraph("A.")], notes: ["y".repeat(400)] }).notes[0]).toHaveLength(300);
  });

  it("says what is wrong with an answer it cannot take", () => {
    expect(parseSummaryAnswer('{"blocks": [')).toEqual({ ok: false, problem: "could not be read as the required JSON" });
    for (const bad of [
      { blocks: [], notes: [] },
      { blocks: Array.from({ length: 13 }, () => paragraph("A.")), notes: [] },
      { blocks: [{ type: "bullet_list", items: Array.from({ length: 21 }, () => "A.") }], notes: [] },
      { blocks: [paragraph("x".repeat(1501))], notes: [] },
      { blocks: [{ type: "heading", items: ["A."] }], notes: [] },
      { blocks: [paragraph("A.")] },
    ]) {
      const read = parseSummaryAnswer(JSON.stringify(bad));
      expect(read.ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("answerToDoc", () => {
  it("makes **bold** into bold marks", () => {
    const { doc, repairs } = docOf(answer([paragraph("The inspection concluded **PASSED**. **Weight** passed with a warning.")]));
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The inspection concluded " },
            { type: "text", text: "PASSED", marks: [{ type: "bold" }] },
            { type: "text", text: ". " },
            { type: "text", text: "Weight", marks: [{ type: "bold" }] },
            { type: "text", text: " passed with a warning." },
          ],
        },
      ],
    });
    expect(repairs).toEqual([]);
  });

  it("drops all the bold of a string whose ** do not pair up", () => {
    const { doc, repairs } = docOf(answer([paragraph("The inspection concluded **PASSED. **Weight** passed.")]));
    expect(doc.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "The inspection concluded PASSED. Weight passed." }] }]);
    expect(repairs).toEqual(["unbalanced **: bold dropped"]);
  });

  it("strips a bullet, a number or a heading mark written into a string, and joins line breaks", () => {
    const { doc, repairs } = docOf(
      answer([
        { type: "bullet_list", items: ["- Weight passed.", "* Dimension passed.", "• Labeling passed."] },
        { type: "numbered_list", items: ["1. First.", "2) Second."] },
        paragraph("# The lot\nPASSED.\r\n  As sampled."),
      ]),
    );
    expect(summaryPlainText(doc)).toBe("• Weight passed.\n• Dimension passed.\n• Labeling passed.\n\n1. First.\n2. Second.\n\nThe lot PASSED. As sampled.");
    expect(doc.content[1]).toEqual({
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First." }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second." }] }] },
      ],
    });
    expect(new Set(repairs)).toEqual(new Set(["stripped a bullet, number or heading mark", "joined line breaks"]));
  });

  it("gives a paragraph block of two strings two paragraphs, and drops empty strings and lists", () => {
    const { doc, repairs } = docOf(
      answer([paragraph("First.", "Second."), paragraph("   "), { type: "bullet_list", items: ["", "** **"] }, paragraph("Third.")]),
    );
    expect(summaryPlainText(doc)).toBe("First.\n\nSecond.\n\nThird.");
    expect(doc.content.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(repairs).toContain("a paragraph block held 2 strings");
    expect(repairs).toContain("dropped an empty list");
  });

  it("merges neighbours with the same marks, and never leaves two spaces where runs meet", () => {
    const { doc } = docOf(answer([paragraph("**Dimension****, Weight** and  ** Visual** passed.")]));
    expect(doc.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Dimension, Weight", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "Visual", marks: [{ type: "bold" }] },
          { type: "text", text: " passed." },
        ],
      },
    ]);
  });

  it("colours the conclusion words when the style asks, HOLD staying the text colour while the palette has no amber", () => {
    expect(RESULT_COLOURS).toEqual({ pass: "green", fail: "red", hold: null });
    const text = "The inspection concluded **PASSED**. The suggested result was HOLD; nothing FAILED. PASSEDS and SURPASSED are not words.";
    const { doc } = docOf(answer([paragraph(text)]), { colourResult: true });
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "The inspection concluded " },
        { type: "text", text: "PASSED", marks: [{ type: "textStyle", attrs: { fontSize: null, color: "green" } }, { type: "bold" }] },
        { type: "text", text: ". The suggested result was HOLD; nothing " },
        { type: "text", text: "FAILED", marks: [{ type: "textStyle", attrs: { fontSize: null, color: "red" } }] },
        { type: "text", text: ". PASSEDS and SURPASSED are not words." },
      ],
    });
    expectFieldDocument(doc);

    const withAmber = docOf(answer([paragraph("On **HOLD**.")]), { colourResult: true, colours: { ...RESULT_COLOURS, hold: "orange" } });
    expect(withAmber.doc.content[0]).toMatchObject({
      content: [{ text: "On " }, { text: "HOLD", marks: [{ type: "textStyle", attrs: { color: "orange" } }, { type: "bold" }] }, { text: "." }],
    });
    expect(docOf(answer([paragraph(text)]), { colourResult: false }).doc.content[0]).toMatchObject({
      content: [{ text: "The inspection concluded " }, { text: "PASSED", marks: [{ type: "bold" }] }, {}],
    });
  });

  it("colours the template's own words", () => {
    const { doc } = docOf(answer([paragraph("The goods were ON HOLD, not ACCEPTED.")]), {
      colourResult: true,
      words: { pass: "ACCEPTED", fail: "REJECTED", hold: "ON HOLD" },
      colours: { pass: "green", fail: "red", hold: "orange" },
    });
    expect(doc.content[0]).toMatchObject({
      content: [
        { text: "The goods were " },
        { text: "ON HOLD", marks: [{ type: "textStyle", attrs: { color: "orange" } }] },
        { text: ", not " },
        { text: "ACCEPTED", marks: [{ type: "textStyle", attrs: { color: "green" } }] },
        { text: "." },
      ],
    });
  });

  it("colours the conclusion word that Chinese characters touch", () => {
    const { doc } = docOf(answer([paragraph("本次检验结论为PASSED。")]), { colourResult: true, emphasis: "none" });
    expect(doc.content[0]).toMatchObject({
      content: [{ text: "本次检验结论为" }, { text: "PASSED", marks: [{ type: "textStyle", attrs: { color: "green" } }] }, { text: "。" }],
    });
    expectFieldDocument(doc);
  });

  it("strips the bold with No Bold", () => {
    const { doc } = docOf(answer([paragraph("The inspection concluded **PASSED**.")]), { emphasis: "none" });
    expect(doc.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "The inspection concluded PASSED." }] }]);
  });

  it("takes out control characters and half an emoji", () => {
    const { doc } = docOf(answer([paragraph("Passed\u0007 with\tcare \ud83d.")]));
    expect(summaryPlainText(doc)).toBe("Passed with care .");
  });

  it("makes the lab's answers into documents the field accepts, lists never nested", () => {
    for (const lab of [LAB_OPUS_PARAGRAPH_LIST, LAB_SONNET_HEADED]) {
      for (const colourResult of [false, true]) {
        const { doc, repairs } = docOf(lab, { colourResult });
        expect(repairs).toEqual([]);
        expectFieldDocument(doc);
      }
    }
    const { doc } = docOf(LAB_OPUS_PARAGRAPH_LIST);
    expect(doc.content.map((block) => block.type)).toEqual(["paragraph", "paragraph", "bulletList"]);
    expect(summaryPlainText(doc)).toContain("• Glove Packing Check passed: Layering 89.4% (min. 70%), Dispensing 91.4% (min. 80%), Stickiness A.");
  });
});

describe("house wording", () => {
  const VERDICT = "The goods inspected conform to the order.";
  const CLOSING = "This summary reflects the goods sampled at the time and place of inspection.";
  const written = docOf(answer([paragraph("The inspection concluded **PASSED**.")])).doc;

  it("goes after Steri-AI's text word for word, the verdict first, each its own paragraph", () => {
    const full = appendHouseWording(written, { verdict: `  ${VERDICT} `, closing: CLOSING });
    expect(full.content.slice(1)).toEqual([
      { type: "paragraph", content: [{ type: "text", text: VERDICT }] },
      { type: "paragraph", content: [{ type: "text", text: CLOSING }] },
    ]);
    expect(appendHouseWording(written, { verdict: null, closing: null })).toEqual(written);
    expectFieldDocument(full);
  });

  it("comes off a polished text and goes back after it, only when the text ends with it", () => {
    const full = appendHouseWording(written, { verdict: VERDICT, closing: CLOSING });
    expect(stripHouseWording(full, { verdict: VERDICT, closing: CLOSING })).toEqual({
      doc: written,
      wording: { verdict: VERDICT, closing: CLOSING },
    });
    const closingOnly = appendHouseWording(written, { verdict: null, closing: CLOSING });
    expect(stripHouseWording(closingOnly, { verdict: VERDICT, closing: CLOSING })).toEqual({ doc: written, wording: { verdict: null, closing: CLOSING } });
    // Edited, or not at the end: it is the inspector's text, polished like the rest.
    const edited = appendHouseWording(written, { verdict: null, closing: "This summary reflects the goods sampled." });
    expect(stripHouseWording(edited, { verdict: VERDICT, closing: CLOSING })).toEqual({ doc: edited, wording: { verdict: null, closing: null } });
    const notLast = { type: "doc" as const, content: [...closingOnly.content, ...written.content] };
    expect(stripHouseWording(notLast, { verdict: null, closing: CLOSING }).wording).toEqual({ verdict: null, closing: null });
  });
});

describe("docToInlineText", () => {
  const typed: RichTextDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "The lot " },
          { type: "text", text: "PASSED ", marks: [{ type: "textStyle", attrs: { fontSize: "large", color: "green" } }, { type: "bold" }] },
          { type: "text", text: "with care", marks: [{ type: "bold" }, { type: "italic" }] },
          { type: "text", text: ".", marks: [{ type: "underline" }] },
        ],
      },
      { type: "paragraph" },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Weight passed." }] }] },
          { type: "listItem", content: [{ type: "paragraph" }] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Third.", marks: [{ type: "bold" }] }] }] }],
      },
    ],
  };

  it("sends bold as **…** and lists as lines, other formatting dropped", () => {
    expect(docToInlineText(typed)).toBe("The lot **PASSED with care**.\n\n- Weight passed.\n\n3. **Third.**");
  });

  it("round-trips bold through the answer", () => {
    const blocks = docToInlineText(typed)
      .split("\n\n")
      .map((block): SummaryAnswer["blocks"][number] =>
        block.startsWith("- ") ? { type: "bullet_list", items: block.split("\n") } : /^\d+\. /.test(block) ? { type: "numbered_list", items: block.split("\n") } : paragraph(block),
      );
    const { doc } = docOf(answer(blocks));
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "The lot " },
        { type: "text", text: "PASSED with care", marks: [{ type: "bold" }] },
        { type: "text", text: "." },
      ],
    });
    expect(docToInlineText(doc)).toBe("The lot **PASSED with care**.\n\n- Weight passed.\n\n1. **Third.**");
  });
});
