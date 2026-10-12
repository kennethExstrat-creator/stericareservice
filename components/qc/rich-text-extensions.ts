// The editor's schema and behaviour (Tiptap 3, on ProseMirror), held to the
// stored allow-list (lib/schemas/rich-text.ts): paragraphs, line breaks,
// bulleted and numbered lists one level deep, bold, italic, underline,
// strikethrough, a size, a colour, a highlight and an alignment. Sizes,
// colours, highlights and alignments render as data attributes and classes
// (rich-text-classes.ts), never inline styles, and parse back from those
// data attributes only: what another program pasted (11pt, #000000,
// windowtext) makes no mark, while a copy and paste inside the editor keeps
// it. No React, so the test reads the schema in Node. Imported only by the
// editor and its test, so Tiptap stays in the editor's chunk.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { ListItem, OrderedList } from "@tiptap/extension-list";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { CharacterCount } from "@tiptap/extensions";
import {
  RICH_TEXT_ALIGNS,
  RICH_TEXT_COLOURS,
  RICH_TEXT_HIGHLIGHTS,
  RICH_TEXT_MAX_CHARACTERS,
  RICH_TEXT_MAX_PARAGRAPHS,
  RICH_TEXT_SIZES,
  type RichTextAlign,
  type RichTextColour,
  type RichTextHighlight,
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
