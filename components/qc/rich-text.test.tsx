// Formatted text in the kit: the editor's schema held to the stored
// allow-list, the class maps held to the palette, and the server-rendered
// markup of RichTextView and RichTextEditor (the editor itself starts in the
// browser; until then the text area shows the document read-only). A
// document put in through the editor's ref: rich-text-insert.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import {
  RICH_TEXT_COLOUR_HEX,
  RICH_TEXT_HIGHLIGHT_HEX,
  RICH_TEXT_MARK_ORDER,
  RICH_TEXT_SIZE_EM,
  toRichTextDoc,
} from "@/lib/rich-text";
import { richTextExample, richTextParagraph } from "@/lib/rich-text/__fixtures__/example";
import { RICH_TEXT_COLOURS, RICH_TEXT_HIGHLIGHTS, RICH_TEXT_MAX_CHARACTERS, RICH_TEXT_SIZES } from "@/lib/schemas/rich-text";
import {
  RICH_TEXT_COLOUR_CLASS,
  RICH_TEXT_COLOUR_SWATCH,
  RICH_TEXT_CONTENT_CLASS,
  RICH_TEXT_HIGHLIGHT_CLASS,
  RICH_TEXT_SIZE_CLASS,
} from "./rich-text-classes";
import { RichTextEditor } from "./rich-text-editor";
import { RICH_TEXT_EXTENSIONS } from "./rich-text-extensions";
import { RichTextView } from "./rich-text-view";

const noop = () => {};
const schema = getSchema(RICH_TEXT_EXTENSIONS);
/** The content rules as an attribute holds them. */
const CONTENT = RICH_TEXT_CONTENT_CLASS.replaceAll("&", "&amp;");
const pattern = (text: string) => text.replace(/[[\]().*+?^$|{}\\]/g, "\\$&");

describe("the editor's schema", () => {
  it("holds exactly the stored nodes and marks", () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(["bulletList", "doc", "hardBreak", "listItem", "orderedList", "paragraph", "text"]);
    // In the order the normaliser writes them.
    expect(Object.keys(schema.marks)).toEqual([...RICH_TEXT_MARK_ORDER]);
  });

  it("keeps lists one level deep and attributes to the stored ones", () => {
    expect(schema.nodes.listItem.spec.content).toBe("paragraph");
    const attributes = (spec: { attrs?: Record<string, { default?: unknown }> }) =>
      Object.fromEntries(Object.entries(spec.attrs ?? {}).map(([name, attribute]) => [name, attribute.default]));
    expect(attributes(schema.nodes.paragraph.spec)).toEqual({ textAlign: null });
    expect(attributes(schema.nodes.orderedList.spec)).toEqual({ start: 1 });
    expect(attributes(schema.nodes.bulletList.spec)).toEqual({});
    expect(attributes(schema.nodes.listItem.spec)).toEqual({});
    expect(attributes(schema.marks.textStyle.spec)).toEqual({ color: null, fontSize: null });
    expect(attributes(schema.marks.highlight.spec)).toEqual({ color: "yellow" });
    for (const mark of ["bold", "italic", "underline", "strike"]) expect(attributes(schema.marks[mark].spec), mark).toEqual({});
  });

  it("binds no Tab in a list item: one level, so Tab leaves the text instead of nesting", () => {
    // ListItem's own Tab sinks the item, a list in a list item, which this schema refuses (ProseMirror throws).
    const listItem = RICH_TEXT_EXTENSIONS.find((extension) => extension.name === "listItem");
    const bind = listItem?.config.addKeyboardShortcuts as ((this: unknown) => Record<string, unknown>) | undefined;
    const shortcuts = bind?.call({ name: "listItem", editor: {}, options: {}, storage: {} }) ?? {};
    expect(Object.keys(shortcuts).sort()).toEqual(["Enter", "Shift-Tab"]);
  });

  it("reads the stored document and writes it back the same", () => {
    const node = Node.fromJSON(schema, richTextExample());
    expect(() => node.check()).not.toThrow();
    expect(toRichTextDoc(node.toJSON())).toEqual(richTextExample());
  });

  it("refuses a nested list", () => {
    const nested = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "a" }] },
                { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(() => Node.fromJSON(schema, nested).check()).toThrow();
  });
});

describe("the class maps", () => {
  it("are the palette, as literal classes", () => {
    for (const size of RICH_TEXT_SIZES) expect(RICH_TEXT_SIZE_CLASS[size]).toBe(`text-[${RICH_TEXT_SIZE_EM[size]}]`);
    for (const colour of RICH_TEXT_COLOURS) {
      expect(RICH_TEXT_COLOUR_CLASS[colour]).toBe(`text-[${RICH_TEXT_COLOUR_HEX[colour]}]`);
      expect(RICH_TEXT_COLOUR_SWATCH[colour]).toBe(`bg-[${RICH_TEXT_COLOUR_HEX[colour]}]`);
    }
    for (const highlight of RICH_TEXT_HIGHLIGHTS) expect(RICH_TEXT_HIGHLIGHT_CLASS[highlight]).toBe(`bg-[${RICH_TEXT_HIGHLIGHT_HEX[highlight]}]`);
  });
});

describe("RichTextView", () => {
  it("draws the document as elements with classes, the structure of the export's HTML", () => {
    expect(renderToStaticMarkup(<RichTextView doc={richTextExample()} />)).toBe(
      `<div class="${CONTENT}"><p class="text-center"><strong>Shipment </strong><span class="text-[1.25em] text-[#166534]"><mark class="bg-[#fef08a]">released</mark></span><br/></p><p><br/></p><ul><li>Two cartons re-taped</li></ul><ol start="3"><li><br/></li></ol></div>`,
    );
  });

  it("never writes a style, and escapes the text", () => {
    const html = renderToStaticMarkup(<RichTextView doc={richTextParagraph("<b>not bold</b>")} />);
    expect(html).not.toContain("style=");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
  });

  it("is an empty box when nothing is written", () => {
    expect(renderToStaticMarkup(<RichTextView doc={null} className="min-h-24" />)).toBe(`<div class="min-h-24 ${CONTENT}"></div>`);
  });

  it("keeps its relaxed line height whatever text size the caller sets", () => {
    expect(renderToStaticMarkup(<RichTextView doc={null} className="text-base fine:text-sm" />)).toContain("leading-relaxed");
  });
});

/** Each button's name, in order, with its state. */
function controls(html: string) {
  return [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    name: /aria-label="([^"]+)"/.exec(tag)?.[1],
    pressed: /aria-pressed="(true|false)"/.exec(tag)?.[1] ?? null,
    unavailable: tag.includes('aria-disabled="true"'),
  }));
}

describe("RichTextEditor", () => {
  it("has a toolbar named Formatting with the thirteen controls in order", () => {
    const html = renderToStaticMarkup(<RichTextEditor value={richTextExample()} onChange={noop} labelledBy="summary-label" />);
    expect(html).toMatch(/<div role="toolbar"[^>]*aria-label="Formatting"/);
    const toolbarControls = /aria-controls="([^"]+)"/.exec(/<div role="toolbar"[^>]*>/.exec(html)?.[0] ?? "")?.[1];
    expect(toolbarControls).toBeTruthy();
    expect(controls(html).map((control) => control.name)).toEqual([
      "Undo",
      "Redo",
      "Font Size",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Font Colour",
      "Highlight",
      "Bulleted List",
      "Numbered List",
      "Align",
      "Clear Formatting",
    ]);
  });

  it("splits the toolbar into seven groups by hairlines that never end a row", () => {
    const html = renderToStaticMarkup(<RichTextEditor value={null} onChange={noop} />);
    const toolbar = /<div role="toolbar"[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
    // Clipped at its 6 px padding: the line before a group that starts a row sits 8 px to the left of it.
    expect(toolbar).toEqual(expect.arrayContaining(["overflow-hidden", "p-1.5"]));
    expect(html).toMatch(/<div role="toolbar"[^>]*><div class="-ms-4 flex flex-wrap gap-y-1">/);
    const groups = [...html.matchAll(/<div class="relative flex flex-nowrap gap-0.5 ps-4 before:[^"]*">/g)];
    expect(groups).toHaveLength(7);
    expect(groups[0][0]).toContain("before:start-2");
    expect(groups[0][0]).toContain("before:bg-border");
  });

  it("starts with nothing to undo or redo and no formatting pressed, and no menu open", () => {
    const html = renderToStaticMarkup(<RichTextEditor value={richTextExample()} onChange={noop} />);
    const byName = Object.fromEntries(controls(html).map((control) => [control.name, control]));
    expect(byName.Undo).toMatchObject({ unavailable: true, pressed: null });
    expect(byName.Redo).toMatchObject({ unavailable: true, pressed: null });
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Bulleted List", "Numbered List"]) {
      expect(byName[name], name).toMatchObject({ pressed: "false", unavailable: false });
    }
    expect(byName["Clear Formatting"]).toMatchObject({ pressed: null, unavailable: false });
    // The menus' options render only while open.
    expect(html).not.toContain('role="radio"');
  });

  it("shows the saved document formatted in the text area until the editor starts, marked for issue links", () => {
    const html = renderToStaticMarkup(
      <RichTextEditor value={richTextExample()} onChange={noop} issuePath={["inspectionSummary"]} />,
    );
    expect(html).toContain('data-slot="rich-text-editor"');
    expect(html).toMatch(/data-issue-path="\[&quot;inspectionSummary&quot;\]"><div class="[^"]*min-h-65[^"]*"><p class="text-center"><strong>Shipment <\/strong>/);
    // White, not the read-only grey; nothing editable on the server.
    expect(html).toContain('<div class="flex flex-1 flex-col rounded-md border border-input bg-card shadow-xs">');
    expect(html).not.toContain('role="textbox"');
    expect(html).not.toContain("contenteditable");
    // The writing area: 16 px on every device on relaxed lines (the content's line height after its own
    // size), with room around the text, at least 320 px tall on a landscape screen and 260 px on a portrait one.
    const area = /data-issue-path="[^"]*"><div class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(area).toMatch(/text-base .*leading-relaxed/);
    expect(area).not.toContain("fine:text-sm");
    for (const rule of ["min-h-65", "landscape:min-h-80", "px-4", "py-3", "touch:px-5", "touch:py-4"]) expect(area.split(" ")).toContain(rule);
    // The toolbar sticks under the screen's bars.
    expect(html).toContain("sticky top-[var(--capture-sticky-top,0px)]");
  });

  it("counts characters from 4,500, in amber at the limit", () => {
    const quiet = renderToStaticMarkup(<RichTextEditor value={richTextParagraph("a".repeat(4499))} onChange={noop} />);
    expect(quiet).toMatch(/<p id="[^"]+" hidden=""[^>]*><\/p>/);
    const counted = renderToStaticMarkup(<RichTextEditor value={richTextParagraph("a".repeat(4612))} onChange={noop} />);
    expect(counted).toContain(">4,612 of 5,000 characters</p>");
    expect(counted).not.toContain("text-warn");
    const full = renderToStaticMarkup(<RichTextEditor value={richTextParagraph("a".repeat(RICH_TEXT_MAX_CHARACTERS))} onChange={noop} />);
    // Full: amber with the warning icon, never colour alone.
    expect(full).toMatch(/<p id="[^"]+" class="[^"]*text-warn[^"]*"><svg [^>]*aria-hidden="true"[^>]*>.*<\/svg>5,000 of 5,000 characters<\/p>/);
    // Below the limit, words only.
    expect(/<p id="[^"]+"[^>]*>(?:(?!<\/p>)[^])*<\/p>/.exec(counted)?.[0]).not.toContain("<svg");
  });

  it("keeps the editor while busy, every toolbar control greyed out but focusable", () => {
    const html = renderToStaticMarkup(<RichTextEditor value={richTextExample()} onChange={noop} busy labelledBy="summary-label" />);
    // The white frame and its toolbar, not the read-only grey box: the editor, and its undo history, stay.
    expect(html).toContain('data-slot="rich-text-editor"');
    expect(html).not.toContain('data-slot="rich-text-read-only"');
    const all = controls(html);
    expect(all).toHaveLength(13);
    for (const control of all) expect(control, control.name).toMatchObject({ unavailable: true });
    // aria-disabled only, so the toolbar keeps its Tab stop and the focus is never dropped.
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
    expect(html).not.toContain('role="radio"');
  });

  it("is a grey read-only box without a toolbar or anything editable", () => {
    const html = renderToStaticMarkup(
      <RichTextEditor value={richTextExample()} onChange={noop} readOnly labelledBy="summary-label" issuePath={["inspectionSummary"]} />,
    );
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("contenteditable");
    const box = /<div role="textbox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(box).toContain('aria-readonly="true"');
    expect(box).toContain('aria-multiline="true"');
    expect(box).toContain('aria-labelledby="summary-label"');
    expect(box).toContain('tabindex="0"');
    expect(box).toContain("bg-muted");
    expect(box).toContain('data-issue-path="[&quot;inspectionSummary&quot;]"');
    // The writing area's size and type: the text reads the same after submit, and nothing moves when the editor replaces it.
    const boxClasses = /class="([^"]*)"/.exec(box)?.[1].split(" ") ?? [];
    for (const rule of ["min-h-65", "landscape:min-h-80", "px-4", "py-3", "touch:px-5", "touch:py-4", "text-base"]) expect(boxClasses).toContain(rule);
    expect(boxClasses).not.toContain("fine:text-sm");
    expect(html).toContain("<strong>Shipment </strong>");
    // Empty: an empty grey box, as the Remark.
    expect(renderToStaticMarkup(<RichTextEditor value={null} onChange={noop} readOnly />)).toMatch(
      new RegExp(`<div role="textbox"[^>]*><div class="${pattern(CONTENT)}"></div></div>`),
    );
  });
});
