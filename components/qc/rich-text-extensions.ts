// The editor's schema and behaviour (Tiptap 3, on ProseMirror), held to the
// stored allow-list (lib/schemas/rich-text.ts): paragraphs, line breaks,
// bulleted and numbered lists one level deep, bold, italic, underline,
// strikethrough, a size, a colour, a highlight and an alignment. Sizes,
// colours, highlights and alignments render as data attributes and classes
// (rich-text-classes.ts), never inline styles, and parse back from those
// data attributes only: what another program pasted (11pt, #000000,
// windowtext) makes no mark, while a copy and paste inside the editor keeps
// it. Also how a document from outside (Steri-AI's draft) goes in as one undo
// step (insertRichTextDocument, the editor's ref). No React, so the tests run
// the schema and a headless editor in Node. Imported only by the editor and
// its tests (others take the handle's types from the editor), so Tiptap stays
// in the editor's chunk.
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { CharacterCount } from "@tiptap/extensions";
import { toRichTextDoc } from "@/lib/rich-text";
import {
  RICH_TEXT_ALIGNS,
  RICH_TEXT_COLOURS,
  RICH_TEXT_HIGHLIGHTS,
  RICH_TEXT_MAX_CHARACTERS,
  RICH_TEXT_MAX_PARAGRAPHS,
  RICH_TEXT_SIZES,
  richTextLength,
  richTextParagraphs,
  type RichTextAlign,
  type RichTextBlock,
  type RichTextColour,
  type RichTextDoc,
  type RichTextHighlight,
  type RichTextInline,
  type RichTextParagraph,
  type RichTextSize,
} from "@/lib/schemas/rich-text";
import { RICH_TEXT_ALIGN_CLASS, RICH_TEXT_COLOUR_CLASS, RICH_TEXT_HIGHLIGHT_CLASS, RICH_TEXT_SIZE_CLASS } from "./rich-text-classes";

function tokenOf<T extends string>(tokens: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (tokens as readonly string[]).includes(value) ? (value as T) : null;
}

export const sizeToken = (value: unknown): RichTextSize | null => tokenOf(RICH_TEXT_SIZES, value);
export const colourToken = (value: unknown): RichTextColour | null => tokenOf(RICH_TEXT_COLOURS, value);
export const highlightToken = (value: unknown): RichTextHighlight | null => tokenOf(RICH_TEXT_HIGHLIGHTS, value);
export const alignToken = (value: unknown): RichTextAlign | null => tokenOf(RICH_TEXT_ALIGNS, value);

/** Where the editor's frame and toolbar are, for keeping the caret clear of the sticky toolbar. */
export const RICH_TEXT_FRAME_SLOT = "rich-text-editor";
export const RICH_TEXT_TOOLBAR_SLOT = "rich-text-toolbar";

/**
 * A list item is one paragraph, so lists are one level. Tab is not bound:
 * ListItem's own Tab sinks the item, which here would put a list inside a
 * list item, a structure the schema refuses (ProseMirror throws "Invalid
 * content for node listItem" from the key handler). Unbound, Tab leaves the
 * text as anywhere else (no keyboard trap). Enter splits the item; Shift+Tab
 * lifts it out of its list.
 */
const RichTextListItem = ListItem.extend({
  content: "paragraph",
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/** start only (v3's `type` dropped), 0–9999 from HTML. */
const RichTextOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
          return Number.isInteger(start) && start >= 0 && start <= 9999 ? start : 1;
        },
      },
    };
  },
});

/** A span is a text style only when it carries one of our tokens (Google Docs and Word spans make none). */
const RichTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: "span",
        consuming: false,
        getAttrs: (element: HTMLElement) =>
          sizeToken(element.getAttribute("data-font-size")) || colourToken(element.getAttribute("data-color")) ? {} : false,
      },
    ];
  },
});

const RichTextColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => colourToken(element.getAttribute("data-color")),
            renderHTML: (attributes: Record<string, unknown>) => {
              const token = colourToken(attributes.color);
              return token ? { "data-color": token, class: RICH_TEXT_COLOUR_CLASS[token] } : {};
            },
          },
        },
      },
    ];
  },
});

const RichTextFontSize = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => sizeToken(element.getAttribute("data-font-size")),
            renderHTML: (attributes: Record<string, unknown>) => {
              const token = sizeToken(attributes.fontSize);
              return token ? { "data-font-size": token, class: RICH_TEXT_SIZE_CLASS[token] } : {};
            },
          },
        },
      },
    ];
  },
});

const RichTextHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (element: HTMLElement) => highlightToken(element.getAttribute("data-highlight")) ?? "yellow",
        renderHTML: (attributes: Record<string, unknown>) => {
          const token = highlightToken(attributes.color) ?? "yellow";
          return { "data-highlight": token, class: RICH_TEXT_HIGHLIGHT_CLASS[token] };
        },
      },
    };
  },
}).configure({ multicolor: true });

const RichTextAlignment = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => alignToken(element.getAttribute("data-align") ?? element.style.textAlign),
            renderHTML: (attributes: Record<string, unknown>) => {
              const token = alignToken(attributes.textAlign);
              return token ? { "data-align": token, class: RICH_TEXT_ALIGN_CLASS[token] } : {};
            },
          },
        },
      },
    ];
  },
  // Left is no alignment, as the toolbar's Align Left sets it.
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.unsetTextAlign(),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
    };
  },
}).configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] });

/** Every paragraph, list items' included: the stored limit's count. */
export function paragraphCount(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "paragraph") count += 1;
    return !node.isTextblock;
  });
  return count;
}

/** Clear Formatting: marks and alignment go, lists stay; with no selection, the next letters come plain. */
export function clearFormatting(editor: Editor, focus = true): boolean {
  const chain = focus ? editor.chain().focus() : editor.chain();
  return chain
    .unsetAllMarks()
    .unsetTextAlign()
    .command(({ tr }) => {
      if (tr.selection.empty) tr.setStoredMarks([]);
      return true;
    })
    .run();
}

/** iPadOS's B, I and U (the callout menu and the shortcut bar) arrive as input events ProseMirror leaves to the browser. */
const FORMAT_INPUT: Readonly<Record<string, (editor: Editor) => boolean>> = {
  formatBold: (editor) => editor.commands.toggleBold(),
  formatItalic: (editor) => editor.commands.toggleItalic(),
  formatUnderline: (editor) => editor.commands.toggleUnderline(),
};

/** Space kept between the caret and the sticky toolbar above it, and the bottom of what is on screen (the iPad keyboard's top). */
const CARET_GAP_TOP = 8;
const CARET_GAP_BOTTOM = 16;

/**
 * Brings the caret into view below the toolbar, which sticks under the
 * screen's own bars (--capture-sticky-top), and above the visual viewport's
 * bottom, which the iPad keyboard raises. The page's scroll padding knows
 * nothing of the toolbar, so the editor scrolls the window itself.
 */
function keepCaretInView(view: EditorView): boolean {
  if (typeof window === "undefined") return false;
  let caret: { top: number; bottom: number };
  try {
    caret = view.coordsAtPos(view.state.selection.head);
  } catch {
    return false;
  }
  const toolbar = view.dom.closest(`[data-slot="${RICH_TEXT_FRAME_SLOT}"]`)?.querySelector(`[data-slot="${RICH_TEXT_TOOLBAR_SLOT}"]`);
  const stuckAt = toolbar ? Number.parseFloat(getComputedStyle(toolbar).top) || 0 : 0;
  const top = stuckAt + (toolbar?.getBoundingClientRect().height ?? 0) + CARET_GAP_TOP;
  const viewport = window.visualViewport;
  const bottom = (viewport ? viewport.offsetTop + viewport.height : window.innerHeight) - CARET_GAP_BOTTOM;
  if (caret.top < top) window.scrollBy({ top: caret.top - top });
  else if (caret.bottom > bottom) window.scrollBy({ top: Math.min(caret.bottom - bottom, caret.top - top) });
  return true;
}

/** The paragraph limit, Clear Formatting's shortcut, iPadOS's B/I/U, and the caret kept clear of the toolbar. */
const RichTextBehaviour = Extension.create({
  name: "richTextBehaviour",

  addKeyboardShortcuts() {
    return { "Mod-\\": () => clearFormatting(this.editor, false) };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("richTextBehaviour"),
        // More than 500 paragraphs is refused, unless the change brings the count down.
        filterTransaction: (tr, state) => {
          if (!tr.docChanged) return true;
          const after = paragraphCount(tr.doc);
          return after <= RICH_TEXT_MAX_PARAGRAPHS || after <= paragraphCount(state.doc);
        },
        props: {
          handleDOMEvents: {
            beforeinput: (_view, event) => {
              const format = FORMAT_INPUT[(event as InputEvent).inputType];
              if (!format) return false;
              event.preventDefault();
              format(editor);
              return true;
            },
          },
          handleScrollToSelection: keepCaretInView,
        },
      }),
    ];
  },
});

export const RICH_TEXT_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: false,
    listItem: false,
    orderedList: false,
    dropcursor: false,
    gapcursor: false,
  }),
  RichTextListItem,
  RichTextOrderedList,
  RichTextStyle,
  RichTextColor,
  RichTextFontSize,
  RichTextHighlight,
  RichTextAlignment,
  CharacterCount.configure({ limit: RICH_TEXT_MAX_CHARACTERS, autoTrim: false }),
  RichTextBehaviour,
];

/* ------------------------------------------------------------------ *
 * A document put in from outside, as one undo step (Steri-AI's draft
 * of the Inspection Summary; 12 October 2026). Writing the data instead
 * would replace the text off the undo history (the editor follows data
 * replaced from outside that way), so the toolbar's Undo could not take
 * the draft back.
 * ------------------------------------------------------------------ */

/**
 * Replace: in place of the whole text. Below: after the text, with a blank
 * line between (paragraphs have no margins here), taking over the empty
 * paragraphs that end it; into an empty field it is the same as replace.
 */
export type RichTextInsertMode = "replace" | "below";

export type RichTextInsertResult =
  | { applied: false }
  | {
      applied: true;
      /** The end did not fit in the room left (5,000 characters, 500 paragraphs) and was cut off, as a paste's is. */
      cut: boolean;
      /** The field just before the change, canonical (null: empty): what an Undo of your own puts back with replace. */
      before: RichTextDoc | null;
      /** The field after it, the document onChange was given (null: empty). */
      after: RichTextDoc | null;
    };

/** What RichTextEditor's `ref` holds. */
export type RichTextEditorHandle = {
  /**
   * Puts a stored document into the text as one step of the editor's own
   * history: the toolbar's Undo (and ⌘/Ctrl+Z) takes it back, Redo puts it
   * back, and typing just before or after it stays a step of its own. It
   * fires onChange as typing does, so autosave runs. It never focuses the
   * text or scrolls the page, so the iPad keyboard stays as it was. It works
   * while the editor is busy. Applied: false, with nothing changed, while
   * there is no editor (read-only, or the first moment before it starts), and
   * for below when there is nothing to add or no room left. Replace with null
   * clears the field. Applied with before equal to after: the field held it
   * already, and nothing was recorded.
   */
  insertDocument: (doc: RichTextDoc | null, mode: RichTextInsertMode) => RichTextInsertResult;
};

const isEmptyParagraph = (node: ProseMirrorNode) => node.type.name === "paragraph" && node.childCount === 0;

/** Where the text ends: after its last block that is not an empty paragraph (the stored text drops those). */
function endOfText(doc: ProseMirrorNode): number {
  let end = 0;
  doc.forEach((node, offset) => {
    if (!isEmptyParagraph(node)) end = offset + node.nodeSize;
  });
  return end;
}

type Room = { characters: number; paragraphs: number };

/** Over the field's limits as given, so the normaliser cuts its end; false for a document it cannot count. */
function overLimits(doc: RichTextDoc): boolean {
  try {
    return richTextLength(doc) > RICH_TEXT_MAX_CHARACTERS || richTextParagraphs(doc).length > RICH_TEXT_MAX_PARAGRAPHS;
  } catch {
    return false;
  }
}

/**
 * The blocks that fit in the room, in order. Where either runs out, the rest
 * goes and a text is cut there, never in half an emoji. So the end of what
 * goes in is cut and the text already there stays whole: a paste's rule
 * (CharacterCount cuts the end of what was pasted), counted in characters as
 * the normaliser cuts (lib/rich-text), so it always fits.
 */
function fitBlocks(blocks: readonly RichTextBlock[], room: Room): { blocks: RichTextBlock[]; cut: boolean } {
  let { characters, paragraphs } = room;
  let cut = false;
  const fit = (paragraph: RichTextParagraph): RichTextParagraph | null => {
    if (characters <= 0 || paragraphs <= 0) {
      cut = true;
      return null;
    }
    paragraphs -= 1;
    const content: RichTextInline[] = [];
    for (const inline of paragraph.content ?? []) {
      if (characters <= 0) {
        cut = true;
        break;
      }
      if (inline.type === "hardBreak") {
        content.push(inline);
        characters -= 1;
        continue;
      }
      let text = inline.text.slice(0, characters);
      if (text.length < inline.text.length) {
        cut = true;
        if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
        characters = 0;
      } else {
        characters -= text.length;
      }
      if (text !== "") content.push({ ...inline, text });
    }
    const fitted: RichTextParagraph = { type: "paragraph" };
    if (paragraph.attrs) fitted.attrs = paragraph.attrs;
    if (content.length > 0) fitted.content = content;
    return fitted;
  };
  const kept: RichTextBlock[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const paragraph = fit(block);
      if (paragraph) kept.push(paragraph);
      continue;
    }
    const items = block.content.flatMap((item) => {
      const paragraph = fit(item.content[0]);
      return paragraph ? [{ type: "listItem" as const, content: [paragraph] as [RichTextParagraph] }] : [];
    });
    if (items.length > 0) kept.push({ ...block, content: items });
  }
  return { blocks: kept, cut };
}

/**
 * insertDocument on a live editor (RichTextEditorHandle). The document is
 * normalised first (toRichTextDoc: anything off the allow-list goes) and cut
 * to the room the kept text leaves, then goes in as one transaction with
 * ProseMirror's history closed before it and after it, so it never merges
 * with typing inside the 500 ms the history groups by. The caret ends after
 * what went in, as after a paste; the transaction never scrolls, and nothing
 * here focuses the text. The editor must be live (richTextEditorHandle checks).
 */
export function insertRichTextDocument(editor: Editor, doc: RichTextDoc | null, mode: RichTextInsertMode): RichTextInsertResult {
  const { state } = editor;
  const before = toRichTextDoc(state.doc.toJSON());
  const from = mode === "below" ? endOfText(state.doc) : 0;
  const blankLine = from > 0;
  // As CharacterCount counts: text plus 1 per line break.
  const room: Room = {
    characters: RICH_TEXT_MAX_CHARACTERS - state.doc.textBetween(0, from, undefined, " ").length,
    paragraphs: RICH_TEXT_MAX_PARAGRAPHS - paragraphCount(state.doc.cut(0, from)) - (blankLine ? 1 : 0),
  };
  const fitted = fitBlocks(toRichTextDoc(doc)?.content ?? [], room);
  if (mode === "below" && toRichTextDoc({ type: "doc", content: fitted.blocks }) === null) return { applied: false };
  const cut = fitted.cut || (doc !== null && overLimits(doc));

  const { schema } = state;
  const nodes = fitted.blocks.map((block) => schema.nodeFromJSON(block));
  if (blankLine) nodes.unshift(schema.nodes.paragraph.create());
  if (nodes.length === 0) nodes.push(schema.nodes.paragraph.create());
  const tr = state.tr.replaceWith(from, state.doc.content.size, Fragment.from(nodes));
  if (JSON.stringify(toRichTextDoc(tr.doc.toJSON())) === JSON.stringify(before)) {
    return { applied: true, cut, before, after: before };
  }
  tr.setSelection(Selection.atEnd(tr.doc));
  editor.view.dispatch(closeHistory(tr));
  // Refused by a filter (the limits): nothing changed.
  if (editor.state.doc === state.doc) return { applied: false };
  editor.view.dispatch(closeHistory(editor.state.tr));
  return { applied: true, cut, before, after: toRichTextDoc(editor.state.doc.toJSON()) };
}

/**
 * The handle over whichever editor is live. With none (read-only, not started
 * yet) or a destroyed one (between Tiptap replacing an editor and the screen
 * catching up), nothing is applied.
 */
export function richTextEditorHandle(liveEditor: () => Editor | null): RichTextEditorHandle {
  return {
    insertDocument: (doc, mode) => {
      const editor = liveEditor();
      return editor && !editor.isDestroyed ? insertRichTextDocument(editor, doc, mode) : { applied: false };
    },
  };
}
