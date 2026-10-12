import { describe, expect, it } from "vitest";
import { richTextExample, richTextParagraph } from "@/lib/rich-text/__fixtures__/example";
import {
  isStorableText,
  RICH_TEXT_MAX_CHARACTERS,
  RICH_TEXT_MAX_PARAGRAPHS,
  RichTextDocSchema,
  richTextLength,
  richTextParagraphs,
  type RichTextDoc,
} from "./rich-text";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string, marks?: unknown[]) => (marks ? { type: "text", text: value, marks } : { type: "text", text: value });
const item = (...content: unknown[]) => ({ type: "listItem", content });

describe("RichTextDocSchema", () => {
  it("accepts the canonical document as it is", () => {
    expect(RichTextDocSchema.parse(richTextExample())).toEqual(richTextExample());
    expect(JSON.stringify(RichTextDocSchema.parse(richTextExample()))).toBe(JSON.stringify(richTextExample()));
  });

  it("is null when nothing is written, as the conclusion stores it", () => {
    const optional = RichTextDocSchema.nullable().default(null);
    expect(optional.parse(undefined)).toBeNull();
    expect(optional.parse(null)).toBeNull();
  });

  it("takes a size, a colour, a highlight and an alignment as tokens", () => {
    const styled = doc({
      type: "paragraph",
      attrs: { textAlign: "justify" },
      content: [
        text("a", [{ type: "textStyle", attrs: { fontSize: "xlarge", color: null } }]),
        text("b", [{ type: "textStyle", attrs: { fontSize: null, color: "teal" } }, { type: "highlight", attrs: { color: "pink" } }]),
        text("c", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }]),
      ],
    });
    expect(RichTextDocSchema.safeParse(styled).success).toBe(true);
    expect(RichTextDocSchema.safeParse(doc({ type: "orderedList", attrs: { start: 0 }, content: [item({ type: "paragraph" })] })).success).toBe(
      true,
    );
  });

  it.each<[string, unknown]>([
    ["a heading", doc({ type: "heading", attrs: { level: 1 }, content: [text("Title")] })],
    ["a link", doc(paragraph(text("site", [{ type: "link", attrs: { href: "https://example.com" } }])))],
    ["an image", doc(paragraph({ type: "image", attrs: { src: "x.png" } }))],
    ["a blockquote", doc({ type: "blockquote", content: [paragraph(text("q"))] })],
    ["CSS as a size", doc(paragraph(text("a", [{ type: "textStyle", attrs: { fontSize: "12px; background:url(x)", color: null } }])))],
    ["a hex colour", doc(paragraph(text("a", [{ type: "textStyle", attrs: { fontSize: null, color: "#ff0000" } }])))],
    ["an empty text style", doc(paragraph(text("a", [{ type: "textStyle", attrs: { fontSize: null, color: null } }])))],
    ["a text style missing a key", doc(paragraph(text("a", [{ type: "textStyle", attrs: { color: "red" } }])))],
    ["a highlight off the list", doc(paragraph(text("a", [{ type: "highlight", attrs: { color: "#ffff00" } }])))],
    ["a style attribute", doc({ type: "paragraph", attrs: { style: "color:red" }, content: [text("a")] })],
    ["a class on a mark", doc(paragraph(text("a", [{ type: "bold", attrs: { class: "x" } }])))],
    ["a style on text", doc(paragraph({ type: "text", text: "a", style: "color:red" }))],
    ["alignment left", doc({ type: "paragraph", attrs: { textAlign: "left" }, content: [text("a")] })],
    ["a nested list", doc({ type: "bulletList", content: [item(paragraph(text("a")), { type: "bulletList", content: [item(paragraph(text("b")))] })] })],
    ["a list item with two paragraphs", doc({ type: "bulletList", content: [item(paragraph(text("a")), paragraph(text("b")))] })],
    ["a list with no items", doc({ type: "bulletList", content: [] })],
    ["text directly in the document", doc(text("a"))],
    ["empty text", doc(paragraph(text("")))],
    ["NUL", doc(paragraph(text("a\u0000b")))],
    ["half an emoji", doc(paragraph(text("a\ud83d")))],
    ["a mark listed twice", doc(paragraph(text("a", [{ type: "bold" }, { type: "bold" }])))],
    ["a numbered list from -1", doc({ type: "orderedList", attrs: { start: -1 }, content: [item({ type: "paragraph" })] })],
    ["a numbered list from 1.5", doc({ type: "orderedList", attrs: { start: 1.5 }, content: [item({ type: "paragraph" })] })],
    ["an empty paragraph with an empty content list", doc(paragraph())],
    ["an empty document", doc()],
    ["an HTML string", "<p><strong>Released</strong></p>"],
  ])("refuses %s", (_, value) => {
    expect(RichTextDocSchema.safeParse(value).success).toBe(false);
  });

  it(`holds at most ${RICH_TEXT_MAX_CHARACTERS} characters, a line break counting one`, () => {
    expect(RichTextDocSchema.safeParse(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS))).success).toBe(true);
    expect(RichTextDocSchema.safeParse(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS + 1))).success).toBe(false);
    const withBreak = doc(paragraph(text("a".repeat(RICH_TEXT_MAX_CHARACTERS - 1)), { type: "hardBreak" }));
    expect(RichTextDocSchema.safeParse(withBreak).success).toBe(true);
    const over = doc(paragraph(text("a".repeat(RICH_TEXT_MAX_CHARACTERS)), { type: "hardBreak" }));
    expect(RichTextDocSchema.safeParse(over).success).toBe(false);
  });

  it(`holds at most ${RICH_TEXT_MAX_PARAGRAPHS} paragraphs, list items included`, () => {
    const paragraphs = (count: number) => Array.from({ length: count }, () => ({ type: "paragraph" }));
    expect(RichTextDocSchema.safeParse(doc(...paragraphs(RICH_TEXT_MAX_PARAGRAPHS - 1), paragraph(text("a")))).success).toBe(true);
    expect(RichTextDocSchema.safeParse(doc(...paragraphs(RICH_TEXT_MAX_PARAGRAPHS), paragraph(text("a")))).success).toBe(false);
    const items = { type: "bulletList", content: Array.from({ length: 2 }, () => item({ type: "paragraph" })) };
    expect(RichTextDocSchema.safeParse(doc(...paragraphs(RICH_TEXT_MAX_PARAGRAPHS - 1), items)).success).toBe(false);
  });
});

describe("counting", () => {
  it("counts text characters and line breaks, as the editor's counter does", () => {
    const example: RichTextDoc = richTextExample();
    // "Shipment " + "released" + a line break + "Two cartons re-taped".
    expect(richTextLength(example)).toBe(9 + 8 + 1 + 20);
    expect(richTextParagraphs(example)).toHaveLength(4);
    expect(richTextLength(richTextParagraph("😀"))).toBe(2);
  });

  it("stores no NUL and no lone surrogate", () => {
    expect(isStorableText("Released 😀\tok")).toBe(true);
    for (const bad of ["\u0000", "a\ud83d", "\ude00b", "\ud83d\ud83d"]) expect(isStorableText(bad), JSON.stringify(bad)).toBe(false);
  });
});
