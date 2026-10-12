// Formatted text (lib/schemas/rich-text.ts) shown read-only: the review, a
// submitted inspection's conclusion, and the editor's first paint. React
// elements built from the validated document, the same structure as the
// export's HTML (lib/rich-text richTextHtml) with classes from the shared
// maps: no editor, no dangerouslySetInnerHTML, no inline styles. No hooks,
// so a Server Component renders it as it is.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RichTextDoc, RichTextParagraph, RichTextText } from "@/lib/schemas/rich-text";
import {
  RICH_TEXT_ALIGN_CLASS,
  RICH_TEXT_COLOUR_CLASS,
  RICH_TEXT_CONTENT_CLASS,
  RICH_TEXT_HIGHLIGHT_CLASS,
  RICH_TEXT_SIZE_CLASS,
} from "./rich-text-classes";

/** Outer to inner, as the HTML: the text style's span, the highlight, then strong, em, u, s. */
function Text({ node }: { node: RichTextText }) {
  let content: ReactNode = node.text;
  const marks = node.marks ?? [];
  const has = (type: string) => marks.some((mark) => mark.type === type);
  if (has("strike")) content = <s>{content}</s>;
  if (has("underline")) content = <u>{content}</u>;
  if (has("italic")) content = <em>{content}</em>;
  if (has("bold")) content = <strong>{content}</strong>;
  for (const mark of marks) {
    if (mark.type === "highlight") content = <mark className={RICH_TEXT_HIGHLIGHT_CLASS[mark.attrs.color]}>{content}</mark>;
  }
  for (const mark of marks) {
    if (mark.type === "textStyle") {
      const { fontSize, color } = mark.attrs;
      content = (
        <span className={cn(fontSize && RICH_TEXT_SIZE_CLASS[fontSize], color && RICH_TEXT_COLOUR_CLASS[color])}>{content}</span>
      );
    }
  }
  return content;
}

/** A paragraph's text and line breaks; an empty one keeps its line. */
function Inline({ paragraph }: { paragraph: RichTextParagraph }) {
  const content = paragraph.content ?? [];
  if (content.length === 0) return <br />;
  return content.map((inline, index) => (inline.type === "text" ? <Text key={index} node={inline} /> : <br key={index} />));
}

const alignClass = (paragraph: RichTextParagraph) => (paragraph.attrs ? RICH_TEXT_ALIGN_CLASS[paragraph.attrs.textAlign] : undefined);

/**
 * The content rules come after `className`, so the text keeps its line
 * height (leading-relaxed) whatever text size the caller sets: the editor,
 * the read-only box and the review then set lines alike.
 */
export function RichTextView({ doc, className }: { doc: RichTextDoc | null; className?: string }) {
  return (
    <div className={cn(className, RICH_TEXT_CONTENT_CLASS)}>
      {doc?.content.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <p key={index} className={alignClass(block)}>
              <Inline paragraph={block} />
            </p>
          );
        }
        const items = block.content.map((item, itemIndex) => (
          <li key={itemIndex} className={alignClass(item.content[0])}>
            <Inline paragraph={item.content[0]} />
          </li>
        ));
        if (block.type === "bulletList") return <ul key={index}>{items}</ul>;
        const start = block.attrs?.start ?? 1;
        return (
          <ol key={index} start={start === 1 ? undefined : start}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}
