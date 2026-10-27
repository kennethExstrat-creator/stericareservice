// Formatted text (lib/schemas/rich-text.ts) without React or the editor: the
// palette its tokens stand for, the normaliser the editor runs before every
// save, and the plain text and HTML the export carries (the report and
// Steri-AI read them). Pure, so the server never runs the editor and every
// rule is unit-tested.
import {
  RICH_TEXT_ALIGNS,
  RICH_TEXT_COLOURS,
  RICH_TEXT_HIGHLIGHTS,
  RICH_TEXT_MAX_CHARACTERS,
  RICH_TEXT_MAX_PARAGRAPHS,
  RICH_TEXT_SIZES,
  type RichTextAlign,
  type RichTextBlock,
  type RichTextColour,
  type RichTextDoc,
  type RichTextHighlight,
  type RichTextInline,
  type RichTextList,
  type RichTextMark,
  type RichTextParagraph,
  type RichTextSize,
  type RichTextText,
} from "@/lib/schemas/rich-text";

/* ------------------------------------------------------------------ *
 * Palette: what each token looks like, and its name on the toolbar
 * (Title Case, British spelling). Text colours hold at least 5.25:1 on
 * white and slate-100 and 4.71:1 on every highlight (teal on blue is the
 * weakest pair); index.test.ts measures them. Red, orange and green are
 * the author's emphasis here, never a result.
 * ------------------------------------------------------------------ */

/** Font sizes relative to the text around them; Normal is 1em. */
export const RICH_TEXT_SIZE_EM: Readonly<Record<RichTextSize, string>> = { small: "0.875em", large: "1.25em", xlarge: "1.5em" };
export const RICH_TEXT_SIZE_NAME: Readonly<Record<RichTextSize, string>> = { small: "Small", large: "Large", xlarge: "Extra Large" };

export const RICH_TEXT_COLOUR_HEX: Readonly<Record<RichTextColour, `#${string}`>> = {
  grey: "#45556c", // slate-600
  blue: "#0157a2", // brand-600
  teal: "#007368", // accent-700
  purple: "#6d28d9",
  red: "#b91c1c",
  orange: "#9a3412",
  green: "#166534",
};
export const RICH_TEXT_COLOUR_NAME: Readonly<Record<RichTextColour, string>> = {
  grey: "Grey",
  blue: "Blue",
  teal: "Teal",
  purple: "Purple",
  red: "Red",
  orange: "Orange",
  green: "Green",
};

export const RICH_TEXT_HIGHLIGHT_HEX: Readonly<Record<RichTextHighlight, `#${string}`>> = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  blue: "#dbeafe",
  pink: "#fce7f3",
};
export const RICH_TEXT_HIGHLIGHT_NAME: Readonly<Record<RichTextHighlight, string>> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

/**
 * Marks in the order the editor's schema ranks them, which is the order it
 * writes them in: the normaliser sorts into it, so a document read back
 * compares equal to the one saved.
 */
export const RICH_TEXT_MARK_ORDER = ["textStyle", "bold", "italic", "strike", "underline", "highlight"] as const;

/* ------------------------------------------------------------------ *
 * The normaliser
 * ------------------------------------------------------------------ */

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

function tokenOf<T extends string>(tokens: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (tokens as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Control characters (but tab) and lone surrogates out: neither is typed,
 * and Postgres refuses NUL and lone surrogates in jsonb.
 */
function cleanText(text: string): string {
  let clean = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code <= 0x1f && code !== 0x09) || (code >= 0x7f && code <= 0x9f)) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        clean += text.slice(index, index + 2);
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    clean += text[index];
  }
  return clean;
}

function markOf(raw: JsonRecord): RichTextMark | null {
  const attrs = isRecord(raw.attrs) ? raw.attrs : {};
  switch (raw.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strike":
      return { type: raw.type };
    case "textStyle": {
      const fontSize = tokenOf(RICH_TEXT_SIZES, attrs.fontSize);
      const color = tokenOf(RICH_TEXT_COLOURS, attrs.color);
      return fontSize === null && color === null ? null : { type: "textStyle", attrs: { fontSize, color } };
    }
    case "highlight":
      return { type: "highlight", attrs: { color: tokenOf(RICH_TEXT_HIGHLIGHTS, attrs.color) ?? "yellow" } };
    default:
      return null;
  }
}

/** Known marks in the schema's order, each type once (the first one wins). */
function marksOf(raw: unknown): RichTextMark[] {
  if (!Array.isArray(raw)) return [];
  const byType = new Map<string, RichTextMark>();
  for (const entry of raw) {
    const mark = isRecord(entry) ? markOf(entry) : null;
    if (mark && !byType.has(mark.type)) byType.set(mark.type, mark);
  }
  return RICH_TEXT_MARK_ORDER.flatMap((type) => byType.get(type) ?? []);
}

function textNode(text: string, marks: readonly RichTextMark[]): RichTextText {
  return marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text };
}

/** Text and line breaks; neighbouring text with the same marks joins, as the editor joins it. */
function inlineOf(raw: unknown): RichTextInline[] {
  if (!Array.isArray(raw)) return [];
  const inline: RichTextInline[] = [];
  for (const node of raw) {
    if (!isRecord(node)) continue;
    if (node.type === "hardBreak") {
      inline.push({ type: "hardBreak" });
    } else if (node.type === "text" && typeof node.text === "string") {
      const text = cleanText(node.text);
      if (text === "") continue;
      const marks = marksOf(node.marks);
      const last = inline[inline.length - 1];
      if (last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) {
        inline[inline.length - 1] = textNode(last.text + text, marks);
      } else {
        inline.push(textNode(text, marks));
      }
    }
  }
  return inline;
}

function paragraphOf(node: JsonRecord): RichTextParagraph {
  const align = tokenOf(RICH_TEXT_ALIGNS, isRecord(node.attrs) ? node.attrs.textAlign : null);
  return withParts(align, inlineOf(node.content));
}

function withParts(align: RichTextAlign | null, content: readonly RichTextInline[]): RichTextParagraph {
  return {
    type: "paragraph",
    ...(align ? { attrs: { textAlign: align } } : {}),
    ...(content.length > 0 ? { content: [...content] } : {}),
  };
}

/** Each item as its first paragraph; an item with none is dropped. */
function itemsOf(raw: unknown): RichTextList["content"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item) || item.type !== "listItem" || !Array.isArray(item.content)) return [];
    const first = item.content.find((child): child is JsonRecord => isRecord(child) && child.type === "paragraph");
    return first ? [{ type: "listItem" as const, content: [paragraphOf(first)] as [RichTextParagraph] }] : [];
  });
}

function startOf(attrs: unknown): number {
  const start = isRecord(attrs) ? attrs.start : undefined;
  return typeof start === "number" && Number.isFinite(start) ? Math.min(9999, Math.max(0, Math.trunc(start))) : 1;
}

function listOf(type: "bulletList" | "orderedList", start: number, items: RichTextList["content"]): RichTextList {
  if (type === "bulletList") return { type, content: items };
  return start === 1 ? { type, content: items } : { type, attrs: { start }, content: items };
}

const isEmptyParagraph = (block: RichTextBlock) => block.type === "paragraph" && !block.content;

function withoutTrailingEmpty(blocks: RichTextBlock[]): RichTextBlock[] {
  let end = blocks.length;
  while (end > 0 && isEmptyParagraph(blocks[end - 1])) end -= 1;
  return blocks.slice(0, end);
}

function paragraphsOf(blocks: readonly RichTextBlock[]): RichTextParagraph[] {
  return blocks.flatMap((block) => (block.type === "paragraph" ? [block] : block.content.map((item) => item.content[0])));
}

/**
 * The first 500 paragraphs, text cut after 5,000 characters. The editor's
 * own limits keep a document inside both, so this never runs there.
 */
function withinLimits(blocks: RichTextBlock[]): RichTextBlock[] {
  let paragraphs = RICH_TEXT_MAX_PARAGRAPHS;
  let characters = RICH_TEXT_MAX_CHARACTERS;
  // Once either budget is spent, what follows goes.
  const cut = (paragraph: RichTextParagraph): RichTextParagraph | null => {
    if (paragraphs === 0 || characters === 0) return null;
    paragraphs -= 1;
    const content: RichTextInline[] = [];
    for (const inline of paragraph.content ?? []) {
      if (characters === 0) break;
      if (inline.type === "hardBreak") {
        content.push(inline);
        characters -= 1;
        continue;
      }
      let text = inline.text.slice(0, characters);
      // Never half an emoji.
      if (text.length < inline.text.length && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
      characters = text.length < inline.text.length ? 0 : characters - text.length;
      if (text !== "") content.push(textNode(text, inline.marks ?? []));
    }
    return withParts(paragraph.attrs?.textAlign ?? null, content);
  };
  const kept: RichTextBlock[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const paragraph = cut(block);
      if (paragraph) kept.push(paragraph);
      continue;
    }
    const items = block.content.flatMap((item) => {
      const paragraph = cut(item.content[0]);
      return paragraph ? [{ type: "listItem" as const, content: [paragraph] as [RichTextParagraph] }] : [];
    });
    if (items.length > 0) kept.push(listOf(block.type, block.type === "orderedList" ? (block.attrs?.start ?? 1) : 1, items));
  }
  return kept;
}

function exceedsLimits(blocks: readonly RichTextBlock[]): boolean {
  const paragraphs = paragraphsOf(blocks);
  if (paragraphs.length > RICH_TEXT_MAX_PARAGRAPHS) return true;
  let length = 0;
  for (const paragraph of paragraphs) {
    for (const inline of paragraph.content ?? []) length += inline.type === "text" ? inline.text.length : 1;
  }
  return length > RICH_TEXT_MAX_CHARACTERS;
}

/**
 * The editor's JSON (editor.getJSON()) as the stored canonical document
 * (lib/schemas/rich-text.ts), or null when nothing is written. Its output
 * always passes RichTextDocSchema, so a save is never refused as invalid.
 *
 * - A missing or malformed document is null.
 * - Paragraphs and the two list types stay; other blocks go. A list item
 *   becomes its first paragraph; a list with no items goes. An ordered list's
 *   start is clamped to 0–9999 and left out when it is 1.
 * - Alignment "left", or anything off the list, is none.
 * - Text stays (control characters but tab and lone surrogates taken out,
 *   empty text dropped), and so do line breaks; other inline nodes go.
 * - Bold, italic, underline and strike stay. A text style keeps each
 *   attribute that is a token (else null) and goes when both are null; a
 *   highlight colour off the list is yellow. Unknown marks and repeats go.
 * - Trailing empty paragraphs go (the editor adds one after a final list).
 * - No text and no line break anywhere: null.
 */
export function toRichTextDoc(json: unknown): RichTextDoc | null {
  if (!isRecord(json) || json.type !== "doc" || !Array.isArray(json.content)) return null;
  const blocks: RichTextBlock[] = [];
  for (const node of json.content) {
    if (!isRecord(node)) continue;
    if (node.type === "paragraph") {
      blocks.push(paragraphOf(node));
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      const items = itemsOf(node.content);
      if (items.length > 0) blocks.push(listOf(node.type, startOf(node.attrs), items));
    }
  }
  const limited = exceedsLimits(blocks) ? withinLimits(blocks) : blocks;
  const content = withoutTrailingEmpty(limited);
  if (!paragraphsOf(content).some((paragraph) => paragraph.content)) return null;
  return { type: "doc", content };
}

/**
 * The same document in canonical form, as text: two documents that say the
 * same thing give the same key, whatever their key order (Postgres jsonb
 * reorders keys) or the editor's leftovers. "null" for nothing written.
 */
export function richTextKey(doc: unknown): string {
  return JSON.stringify(toRichTextDoc(doc));
}

/* ------------------------------------------------------------------ *
 * Plain text: the export, Steri-AI and the report
 * ------------------------------------------------------------------ */

function lineText(paragraph: RichTextParagraph): string {
  return (paragraph.content ?? []).map((inline) => (inline.type === "text" ? inline.text : "\n")).join("");
}

/**
 * The document as plain text. Paragraphs are joined by a blank line; a line
 * break is "\n" (indented two spaces inside a list item); list items are
 * joined by "\n" as "• text" or "3. text", numbered from the list's start
 * by their place, as the HTML numbers them. Empty paragraphs and items are
 * dropped, each paragraph is trimmed, marks are ignored.
 */
export function richTextPlain(doc: RichTextDoc): string {
  const blocks = doc.content.flatMap((block) => {
    if (block.type === "paragraph") {
      const text = lineText(block).trim();
      return text === "" ? [] : [text];
    }
    const start = block.type === "orderedList" ? (block.attrs?.start ?? 1) : 1;
    const items = block.content.flatMap((item, index) => {
      const text = lineText(item.content[0]).trim();
      if (text === "") return [];
      const bullet = block.type === "orderedList" ? `${start + index}. ` : "• ";
      return [`${bullet}${text.replaceAll("\n", "\n  ")}`];
    });
    return items.length === 0 ? [] : [items.join("\n")];
  });
  return blocks.join("\n\n").trim();
}

/* ------------------------------------------------------------------ *
 * HTML: a fragment for the report
 * ------------------------------------------------------------------ */

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const SIMPLE_MARK_TAG = { bold: "strong", italic: "em", underline: "u", strike: "s" } as const;

/** Outer to inner: the text style's span, the highlight's mark, then strong, em, u, s. */
function textHtml(node: RichTextText): string {
  const marks = node.marks ?? [];
  const find = <T extends RichTextMark["type"]>(type: T) =>
    marks.find((mark): mark is Extract<RichTextMark, { type: T }> => mark.type === type);
  let html = escapeHtml(node.text);
  for (const type of ["strike", "underline", "italic", "bold"] as const) {
    if (find(type)) html = `<${SIMPLE_MARK_TAG[type]}>${html}</${SIMPLE_MARK_TAG[type]}>`;
  }
  const highlight = find("highlight");
  if (highlight) html = `<mark style="background-color:${RICH_TEXT_HIGHLIGHT_HEX[highlight.attrs.color]};color:inherit">${html}</mark>`;
  const style = find("textStyle");
  if (style) {
    const declarations = [
      style.attrs.fontSize ? `font-size:${RICH_TEXT_SIZE_EM[style.attrs.fontSize]}` : null,
      style.attrs.color ? `color:${RICH_TEXT_COLOUR_HEX[style.attrs.color]}` : null,
    ].filter((declaration) => declaration !== null);
    html = `<span style="${declarations.join(";")}">${html}</span>`;
  }
  return html;
}

function inlineHtml(paragraph: RichTextParagraph): string {
  const content = paragraph.content ?? [];
  if (content.length === 0) return "<br>";
  return content.map((inline) => (inline.type === "text" ? textHtml(inline) : "<br>")).join("");
}

function alignAttribute(paragraph: RichTextParagraph): string {
  return paragraph.attrs ? ` style="text-align:${paragraph.attrs.textAlign}"` : "";
}

/**
 * The document as an HTML fragment for the report: only p, br, ul, ol,
 * li, span, mark, strong, em, u and s; only `style`, built from the fixed
 * maps above, and `start` on a list that does not start at 1. Text is
 * escaped, and no written text ever reaches an attribute. An empty
 * paragraph or item holds a <br>, so it keeps its line.
 */
export function richTextHtml(doc: RichTextDoc): string {
  return doc.content
    .map((block) => {
      if (block.type === "paragraph") return `<p${alignAttribute(block)}>${inlineHtml(block)}</p>`;
      const items = block.content.map((item) => `<li${alignAttribute(item.content[0])}>${inlineHtml(item.content[0])}</li>`).join("");
      if (block.type === "bulletList") return `<ul>${items}</ul>`;
      const start = block.attrs?.start ?? 1;
      return start === 1 ? `<ol>${items}</ol>` : `<ol start="${start}">${items}</ol>`;
    })
    .join("");
}
