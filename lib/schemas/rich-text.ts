// Formatted text as stored (the conclusion's Inspection Summary; Kenneth,
// 12 October 2026): the editor's JSON document (Tiptap, on ProseMirror) held
// to a fixed allow-list, never HTML from the browser. Each node and mark is a
// strict object, so an attribute the list does not name (style, class, href)
// is refused; size, colour, highlight and alignment are tokens, never CSS, so
// nothing a browser pasted can reach a style. Lists are one level deep: a
// list item is exactly one paragraph.
//
// Canonical form, as the editor stores it (lib/rich-text toRichTextDoc):
// paragraph attrs only for center, right or justify; content left out when
// empty; text marks left out when there are none; orderedList attrs only
// when start is not 1; textStyle always carries both keys, null for the one
// not set. Imported by its path, not through the lib/schemas index.
import { z } from "zod";

/** Font sizes; no size mark is Normal. */
export const RICH_TEXT_SIZES = ["small", "large", "xlarge"] as const;
/** Text colours; no colour is the default text colour (slate-900). */
export const RICH_TEXT_COLOURS = ["grey", "blue", "teal", "purple", "red", "orange", "green"] as const;
export const RICH_TEXT_HIGHLIGHTS = ["yellow", "green", "blue", "pink"] as const;
/** Paragraph alignments; none is left. */
export const RICH_TEXT_ALIGNS = ["center", "right", "justify"] as const;

/** Text characters plus 1 per line break, as the editor counts them (Tiptap CharacterCount, textSize mode). */
export const RICH_TEXT_MAX_CHARACTERS = 5000;
/** Paragraphs, list items included. */
export const RICH_TEXT_MAX_PARAGRAPHS = 500;

export type RichTextSize = (typeof RICH_TEXT_SIZES)[number];
export type RichTextColour = (typeof RICH_TEXT_COLOURS)[number];
export type RichTextHighlight = (typeof RICH_TEXT_HIGHLIGHTS)[number];
export type RichTextAlign = (typeof RICH_TEXT_ALIGNS)[number];

/**
 * True when the text holds no NUL and no lone surrogate: Postgres refuses
 * both in jsonb (a lone surrogate is a half emoji, as a cut can leave one).
 */
export function isStorableText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const TextStyleAttrsSchema = z
  .strictObject({
    fontSize: z.enum(RICH_TEXT_SIZES).nullable(),
    color: z.enum(RICH_TEXT_COLOURS).nullable(),
  })
  .refine((attrs) => attrs.fontSize !== null || attrs.color !== null, "A text style sets a size or a colour.");

const MarkSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({ type: z.literal("underline") }),
  z.strictObject({ type: z.literal("strike") }),
  z.strictObject({ type: z.literal("textStyle"), attrs: TextStyleAttrsSchema }),
  z.strictObject({ type: z.literal("highlight"), attrs: z.strictObject({ color: z.enum(RICH_TEXT_HIGHLIGHTS) }) }),
]);

const MarksSchema = z
  .array(MarkSchema)
  .min(1)
  .max(6)
  .refine((marks) => new Set(marks.map((mark) => mark.type)).size === marks.length, "A mark is listed once.");

const TextSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1).max(RICH_TEXT_MAX_CHARACTERS).refine(isStorableText, "The text holds a character that cannot be stored."),
  marks: MarksSchema.optional(),
});

const HardBreakSchema = z.strictObject({ type: z.literal("hardBreak") });

export const RichTextParagraphSchema = z.strictObject({
  type: z.literal("paragraph"),
  attrs: z.strictObject({ textAlign: z.enum(RICH_TEXT_ALIGNS) }).optional(),
  content: z.array(z.discriminatedUnion("type", [TextSchema, HardBreakSchema])).min(1).optional(),
});

const ListItemSchema = z.strictObject({ type: z.literal("listItem"), content: z.tuple([RichTextParagraphSchema]) });
const ListItemsSchema = z.array(ListItemSchema).min(1);

const BlockSchema = z.discriminatedUnion("type", [
  RichTextParagraphSchema,
  z.strictObject({ type: z.literal("bulletList"), content: ListItemsSchema }),
  z.strictObject({
    type: z.literal("orderedList"),
    attrs: z.strictObject({ start: z.int().min(0).max(9999) }).optional(),
    content: ListItemsSchema,
  }),
]);

export const RichTextDocSchema = z
  .strictObject({ type: z.literal("doc"), content: z.array(BlockSchema).min(1) })
  .superRefine((doc, ctx) => {
    const length = richTextLength(doc);
    if (length > RICH_TEXT_MAX_CHARACTERS) {
      ctx.addIssue({ code: "custom", message: `${length} characters: at most ${RICH_TEXT_MAX_CHARACTERS}.` });
    }
    const paragraphs = richTextParagraphs(doc).length;
    if (paragraphs > RICH_TEXT_MAX_PARAGRAPHS) {
      ctx.addIssue({ code: "custom", message: `${paragraphs} paragraphs: at most ${RICH_TEXT_MAX_PARAGRAPHS}.` });
    }
  });

export type RichTextDoc = z.infer<typeof RichTextDocSchema>;
export type RichTextBlock = RichTextDoc["content"][number];
export type RichTextList = Extract<RichTextBlock, { type: "bulletList" | "orderedList" }>;
export type RichTextParagraph = z.infer<typeof RichTextParagraphSchema>;
export type RichTextInline = NonNullable<RichTextParagraph["content"]>[number];
export type RichTextText = Extract<RichTextInline, { type: "text" }>;
export type RichTextMark = z.infer<typeof MarkSchema>;

/** The document's paragraphs in reading order: top-level ones and each list item's. */
export function richTextParagraphs(doc: Pick<RichTextDoc, "content">): RichTextParagraph[] {
  return doc.content.flatMap((block) => (block.type === "paragraph" ? [block] : block.content.map((item) => item.content[0])));
}

/** Text characters plus 1 per line break (UTF-16 code units, as the editor's counter). */
export function richTextLength(doc: Pick<RichTextDoc, "content">): number {
  let length = 0;
  for (const paragraph of richTextParagraphs(doc)) {
    for (const inline of paragraph.content ?? []) length += inline.type === "text" ? inline.text.length : 1;
  }
  return length;
}
