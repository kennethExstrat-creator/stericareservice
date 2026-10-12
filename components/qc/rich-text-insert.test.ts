// A document put in from outside the editor (Steri-AI's draft of the
// Inspection Summary; 12 October 2026), on a headless editor: Node has no
// DOM, so there is no view, and the plugins a mounted editor runs (history,
// the limits, the trailing paragraph) go on by hand. One step of the editor's
// own history, the update that drives onChange and autosave, the field's
// limits kept by cutting the end of what goes in, and nothing that moves the
// page or the focus.
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { Selection, type Transaction } from "@tiptap/pm/state";
import { richTextPlain, toRichTextDoc } from "@/lib/rich-text";
import { richTextParagraph } from "@/lib/rich-text/__fixtures__/example";
import { RICH_TEXT_MAX_CHARACTERS, RICH_TEXT_MAX_PARAGRAPHS, type RichTextDoc, type RichTextParagraph } from "@/lib/schemas/rich-text";
import { insertRichTextDocument, paragraphCount, RICH_TEXT_EXTENSIONS, richTextEditorHandle } from "./rich-text-extensions";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const BLANK: RichTextParagraph = { type: "paragraph" };
const line = (text: string): RichTextParagraph => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: RichTextDoc["content"]): RichTextDoc => ({ type: "doc", content });

/** A Steri-AI draft as the field stores it (placeholders): a bold conclusion word, a blank line, a list. */
function draft(): RichTextDoc {
  return doc(
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The inspection of [Product] under PO [PO] concluded " },
        { type: "text", text: "PASSED", marks: [{ type: "bold" }] },
        { type: "text", text: "." },
      ],
    },
    BLANK,
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [line("The watertight test found 6 holes in 500 gloves, against accept 14, reject 15.")] }],
    },
  );
}

/** An editor as the field runs it, with what each update hands onChange and every transaction applied. */
function open(value: RichTextDoc | null) {
  const changes: (RichTextDoc | null)[] = [];
  const transactions: Transaction[] = [];
  const editor = new Editor({
    extensions: RICH_TEXT_EXTENSIONS,
    content: value ?? EMPTY_DOC,
    onUpdate: ({ editor: current }) => changes.push(toRichTextDoc(current.getJSON())),
    onTransaction: ({ transaction }) => transactions.push(transaction),
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return { editor, changes, transactions };
}

const stored = (editor: Editor) => toRichTextDoc(editor.getJSON());
const plain = (editor: Editor) => {
  const current = stored(editor);
  return current ? richTextPlain(current) : "";
};
/** Typing at the caret, as the keyboard does: a transaction the history keeps. */
const type = (editor: Editor, text: string) => editor.view.dispatch(editor.state.tr.insertText(text));
const caretToEnd = (editor: Editor) => editor.view.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));

describe("insertRichTextDocument", () => {
  it("replaces the text as one undo step that the editor's Undo takes back and Redo puts back", () => {
    const { editor } = open(richTextParagraph("My own words."));
    expect(insertRichTextDocument(editor, draft(), "replace")).toEqual({
      applied: true,
      cut: false,
      before: richTextParagraph("My own words."),
      after: draft(),
    });
    expect(stored(editor)).toEqual(draft());
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(stored(editor)).toEqual(richTextParagraph("My own words."));
    expect(editor.commands.redo()).toBe(true);
    expect(stored(editor)).toEqual(draft());
  });

  it("fires one update with the new document, as typing does, so onChange and autosave run", () => {
    const { editor, changes } = open(richTextParagraph("Mine."));
    insertRichTextDocument(editor, draft(), "replace");
    // The history's closing transaction changes nothing, so it fires none.
    expect(changes).toEqual([draft()]);
    editor.commands.undo();
    expect(changes).toEqual([draft(), richTextParagraph("Mine.")]);
  });

  it("keeps typing just before and just after it as steps of their own, inside the history's 500 ms group", () => {
    const { editor } = open(richTextParagraph("Mine"));
    caretToEnd(editor);
    type(editor, " and more");
    insertRichTextDocument(editor, richTextParagraph("Draft."), "replace");
    type(editor, " Checked.");
    expect(plain(editor)).toBe("Draft. Checked.");
    editor.commands.undo();
    expect(plain(editor)).toBe("Draft.");
    editor.commands.undo();
    expect(plain(editor)).toBe("Mine and more");
    editor.commands.undo();
    expect(plain(editor)).toBe("Mine");
  });

  it("goes below the text after a blank line, taking over the empty paragraphs that end it", () => {
    const { editor } = open(doc(line("Mine."), BLANK, BLANK));
    const result = insertRichTextDocument(editor, draft(), "below");
    expect(result).toEqual({ applied: true, cut: false, before: doc(line("Mine.")), after: doc(line("Mine."), BLANK, ...draft().content) });
    expect(stored(editor)).toEqual(doc(line("Mine."), BLANK, ...draft().content));
    editor.commands.undo();
    expect(stored(editor)).toEqual(doc(line("Mine.")));
  });

  it("goes below a list after a blank line too, and typing after it stays a step of its own", () => {
    const list = doc({ type: "bulletList", content: [{ type: "listItem", content: [line("One")] }] });
    const { editor } = open(list);
    insertRichTextDocument(editor, richTextParagraph("Draft."), "below");
    expect(stored(editor)).toEqual(doc(...list.content, BLANK, line("Draft.")));
    type(editor, " Checked.");
    editor.commands.undo();
    expect(stored(editor)).toEqual(doc(...list.content, BLANK, line("Draft.")));
    editor.commands.undo();
    expect(stored(editor)).toEqual(list);
  });

  it("fills an empty field with no blank line first, below as replace", () => {
    for (const mode of ["below", "replace"] as const) {
      const { editor } = open(null);
      expect(insertRichTextDocument(editor, richTextParagraph("Draft."), mode)).toEqual({
        applied: true,
        cut: false,
        before: null,
        after: richTextParagraph("Draft."),
      });
    }
  });

  it("cuts the end of what goes in to fit the 5,000 characters, as a paste's end is, and keeps the text already there whole", () => {
    const mine = "a".repeat(RICH_TEXT_MAX_CHARACTERS - 10);
    const { editor } = open(richTextParagraph(mine));
    expect(insertRichTextDocument(editor, doc(line("0123456789ABCDEFGHIJ"), line("Next.")), "below")).toMatchObject({ applied: true, cut: true });
    expect(stored(editor)).toEqual(doc(line(mine), BLANK, line("0123456789")));
    expect(editor.storage.characterCount.characters()).toBe(RICH_TEXT_MAX_CHARACTERS);
    // Exactly the room left: nothing is cut.
    const exact = open(richTextParagraph(mine)).editor;
    expect(insertRichTextDocument(exact, richTextParagraph("0123456789"), "below")).toMatchObject({ applied: true, cut: false });
  });

  it("never cuts an emoji in half, and counts a line break as one character, as the counter does", () => {
    const emoji = open(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS - 2))).editor;
    insertRichTextDocument(emoji, richTextParagraph("x😀y"), "below");
    // The editor's own text, not the stored form, which drops a lone half anyway (it would show as a broken glyph).
    expect(emoji.state.doc.lastChild?.textContent).toBe("x");
    expect(emoji.storage.characterCount.characters()).toBe(RICH_TEXT_MAX_CHARACTERS - 1);

    const lines = open(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS - 3))).editor;
    const broken: RichTextParagraph = {
      type: "paragraph",
      content: [{ type: "text", text: "b" }, { type: "hardBreak" }, { type: "text", text: "cd" }],
    };
    insertRichTextDocument(lines, doc(broken), "below");
    expect(stored(lines)?.content.at(-1)).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "b" }, { type: "hardBreak" }, { type: "text", text: "c" }],
    });
    expect(lines.storage.characterCount.characters()).toBe(RICH_TEXT_MAX_CHARACTERS);
  });

  it("keeps the 500 paragraphs: what goes below past them is cut, the blank line counted", () => {
    const { editor } = open(doc(...Array.from({ length: RICH_TEXT_MAX_PARAGRAPHS - 2 }, () => line("p"))));
    expect(insertRichTextDocument(editor, doc(line("one"), line("two"), line("three")), "below")).toMatchObject({ applied: true, cut: true });
    expect(paragraphCount(editor.state.doc)).toBe(RICH_TEXT_MAX_PARAGRAPHS);
    expect(stored(editor)?.content.at(-1)).toEqual(line("one"));
  });

  it("never cuts a replacement that fits the field, and cuts the end of one that does not", () => {
    const { editor } = open(richTextParagraph("Mine."));
    const full = richTextParagraph("b".repeat(RICH_TEXT_MAX_CHARACTERS));
    expect(insertRichTextDocument(editor, full, "replace")).toEqual({ applied: true, cut: false, before: richTextParagraph("Mine."), after: full });
    // Over the limit as given (the stored schema refuses it): the normaliser keeps the first 5,000, and cut says so.
    expect(insertRichTextDocument(editor, richTextParagraph(`${"c".repeat(RICH_TEXT_MAX_CHARACTERS)}d`), "replace")).toEqual({
      applied: true,
      cut: true,
      before: full,
      after: richTextParagraph("c".repeat(RICH_TEXT_MAX_CHARACTERS)),
    });
  });

  it("applies nothing below a full field, or with nothing to add, and records nothing", () => {
    const full = open(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS)));
    expect(insertRichTextDocument(full.editor, richTextParagraph("More."), "below")).toEqual({ applied: false });
    expect(stored(full.editor)).toEqual(richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS)));
    const mine = open(richTextParagraph("Mine."));
    expect(insertRichTextDocument(mine.editor, null, "below")).toEqual({ applied: false });
    expect(insertRichTextDocument(mine.editor, doc(BLANK), "below")).toEqual({ applied: false });
    for (const { editor, changes } of [full, mine]) {
      expect(changes).toEqual([]);
      expect(undoDepth(editor.state)).toBe(0);
    }
  });

  it("clears the field when replacing with nothing, as one undo step", () => {
    const { editor, changes } = open(richTextParagraph("Mine."));
    expect(insertRichTextDocument(editor, null, "replace")).toEqual({ applied: true, cut: false, before: richTextParagraph("Mine."), after: null });
    expect(changes).toEqual([null]);
    editor.commands.undo();
    expect(stored(editor)).toEqual(richTextParagraph("Mine."));
  });

  it("records nothing when the field already holds the document", () => {
    const { editor, changes } = open(draft());
    expect(insertRichTextDocument(editor, draft(), "replace")).toEqual({ applied: true, cut: false, before: draft(), after: draft() });
    expect(changes).toEqual([]);
    expect(undoDepth(editor.state)).toBe(0);
  });

  it("drops anything off the stored allow-list, as the editor's normaliser does", () => {
    const { editor } = open(null);
    const strange = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [{ type: "text", text: "Kept", marks: [{ type: "link", attrs: { href: "https://example.com" } }, { type: "bold" }] }],
        },
      ],
    } as unknown as RichTextDoc;
    insertRichTextDocument(editor, strange, "replace");
    expect(stored(editor)).toEqual(doc({ type: "paragraph", content: [{ type: "text", text: "Kept", marks: [{ type: "bold" }] }] }));
  });

  it("leaves the caret after what went in and never scrolls the page to it", () => {
    const { editor, transactions } = open(richTextParagraph("Mine."));
    insertRichTextDocument(editor, richTextParagraph("Draft."), "below");
    const { selection } = editor.state;
    expect(selection.empty).toBe(true);
    expect(selection.head).toBe(Selection.atEnd(editor.state.doc).head);
    expect(editor.state.doc.textBetween(selection.head - 6, selection.head)).toBe("Draft.");
    // The change and the history's closing transaction.
    expect(transactions).toHaveLength(2);
    for (const transaction of transactions) expect(transaction.scrolledIntoView).toBe(false);
  });

  it("works while the text cannot be edited (busy)", () => {
    const { editor, changes } = open(richTextParagraph("Mine."));
    editor.setEditable(false, false);
    expect(insertRichTextDocument(editor, draft(), "replace")).toMatchObject({ applied: true });
    expect(changes).toEqual([draft()]);
  });
});

describe("richTextEditorHandle", () => {
  it("applies nothing without a live editor: read-only, not started yet, or destroyed", () => {
    expect(richTextEditorHandle(() => null).insertDocument(draft(), "replace")).toEqual({ applied: false });

    const { editor, changes } = open(richTextParagraph("Mine."));
    // A mounted editor reports itself live; this headless one has no view, which Tiptap counts as destroyed.
    let live = true;
    Object.defineProperty(editor, "isDestroyed", { configurable: true, get: () => !live });
    const handle = richTextEditorHandle(() => editor);
    expect(handle.insertDocument(draft(), "replace")).toMatchObject({ applied: true, after: draft() });
    live = false;
    expect(handle.insertDocument(richTextParagraph("Again."), "replace")).toEqual({ applied: false });
    expect(changes).toEqual([draft()]);
  });
});
