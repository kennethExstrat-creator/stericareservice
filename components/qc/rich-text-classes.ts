// Classes for formatted text (lib/schemas/rich-text.ts), shared by the
// read-only view and the editor, so the two look the same. Literal strings,
// so Tailwind sees them; the values are lib/rich-text's palette. Classes,
// never inline styles, so a later style-src CSP leaves the text as it is.
import type { RichTextAlign, RichTextColour, RichTextHighlight, RichTextSize } from "@/lib/schemas/rich-text";

export const RICH_TEXT_SIZE_CLASS: Readonly<Record<RichTextSize, string>> = {
  small: "text-[0.875em]",
  large: "text-[1.25em]",
  xlarge: "text-[1.5em]",
};

export const RICH_TEXT_COLOUR_CLASS: Readonly<Record<RichTextColour, string>> = {
  grey: "text-[#45556c]",
  blue: "text-[#0157a2]",
  teal: "text-[#007368]",
  purple: "text-[#6d28d9]",
  red: "text-[#b91c1c]",
  orange: "text-[#9a3412]",
  green: "text-[#166534]",
};

/** The dot beside each colour in the toolbar's menu. */
export const RICH_TEXT_COLOUR_SWATCH: Readonly<Record<RichTextColour, string>> = {
  grey: "bg-[#45556c]",
  blue: "bg-[#0157a2]",
  teal: "bg-[#007368]",
  purple: "bg-[#6d28d9]",
  red: "bg-[#b91c1c]",
  orange: "bg-[#9a3412]",
  green: "bg-[#166534]",
};

export const RICH_TEXT_HIGHLIGHT_CLASS: Readonly<Record<RichTextHighlight, string>> = {
  yellow: "bg-[#fef08a]",
  green: "bg-[#bbf7d0]",
  blue: "bg-[#dbeafe]",
  pink: "bg-[#fce7f3]",
};

export const RICH_TEXT_ALIGN_CLASS: Readonly<Record<RichTextAlign, string>> = {
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

/**
 * The text area's own rules: lines wrap as typed, relaxed line height (a
 * summary is read, and a highlight or a larger size keeps clear of the next
 * line), list markers back (the CSS reset removes them), a highlight keeps
 * the text's colour. Paragraphs and lists have no margins, so Enter behaves
 * like a new line in a text box.
 */
export const RICH_TEXT_CONTENT_CLASS =
  "whitespace-pre-wrap break-words leading-relaxed [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_mark]:text-inherit";
