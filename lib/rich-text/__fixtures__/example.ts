// A formatted inspection summary in the stored canonical form
// (lib/schemas/rich-text.ts), with every kind of node and mark: alignment,
// bold, a size and a colour in one text style, a highlight, a line break, an
// empty paragraph, a bulleted list, and a numbered list from 3 whose one
// item is empty. Shared by the schema, the renderers, the editor, the
// conclusion, the export and the review tests.
import type { RichTextDoc } from "@/lib/schemas/rich-text";

export function richTextExample(): RichTextDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          { type: "text", text: "Shipment ", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "released",
            marks: [
              { type: "textStyle", attrs: { fontSize: "large", color: "green" } },
              { type: "highlight", attrs: { color: "yellow" } },
            ],
          },
          { type: "hardBreak" },
        ],
      },
      { type: "paragraph" },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two cartons re-taped" }] }] }],
      },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    ],
  };
}

/** The example as the export's HTML. */
export const RICH_TEXT_EXAMPLE_HTML =
  '<p style="text-align:center"><strong>Shipment </strong><span style="font-size:1.25em;color:#166534"><mark style="background-color:#fef08a;color:inherit">released</mark></span><br></p><p><br></p><ul><li>Two cartons re-taped</li></ul><ol start="3"><li><br></li></ol>';

/** The example as plain text. */
export const RICH_TEXT_EXAMPLE_TEXT = "Shipment released\n\n• Two cartons re-taped";

/** One plain paragraph. */
export function richTextParagraph(text: string): RichTextDoc {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
