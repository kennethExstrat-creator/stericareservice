import { describe, expect, it } from "vitest";
import { AA_TEXT, contrastRatio } from "@/lib/design/contrast";
import {
  RICH_TEXT_COLOURS,
  RICH_TEXT_HIGHLIGHTS,
  RICH_TEXT_MAX_CHARACTERS,
  RICH_TEXT_MAX_PARAGRAPHS,
  RichTextDocSchema,
  richTextLength,
  richTextParagraphs,
  type RichTextDoc,
} from "@/lib/schemas/rich-text";
import { RICH_TEXT_EXAMPLE_HTML, RICH_TEXT_EXAMPLE_TEXT, richTextExample, richTextParagraph } from "./__fixtures__/example";
import {
  RICH_TEXT_COLOUR_HEX,
  RICH_TEXT_HIGHLIGHT_HEX,
  richTextHtml,
  richTextKey,
  richTextPlain,
  toRichTextDoc,
} from "./index";

/** The example as editor.getJSON() hands it over: null attributes, start 1 written out, the trailing paragraph, attribute order its own. */
function editorJson() {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Shipment " },
          {
            type: "text",
            marks: [
              { type: "highlight", attrs: { color: "yellow" } },
              { type: "textStyle", attrs: { color: "green", fontSize: "large" } },
              { type: "link", attrs: { href: "https://example.com" } },
            ],
            text: "released",
          },
          { type: "hardBreak", marks: [{ type: "bold" }] },
        ],
      },
      { type: "paragraph", attrs: { textAlign: null } },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "Two cartons re-taped" }] }],
          },
        ],
      },
      { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: null } }] }] },
      { type: "paragraph", attrs: { textAlign: null } },
    ],
  };
}

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => (marks ? { type: "text", text, marks } : { type: "text", text });
const li = (...content: unknown[]) => ({ type: "listItem", content });

describe("toRichTextDoc", () => {
  it("turns the editor's JSON into the stored canonical document", () => {
    const result = toRichTextDoc(editorJson());
    expect(result).toEqual(richTextExample());
    // Key order too: the editor compares documents as text.
    expect(JSON.stringify(result)).toBe(JSON.stringify(richTextExample()));
  });

  it("is idempotent, and keys a document by what it says whatever its key order", () => {
    expect(toRichTextDoc(richTextExample())).toEqual(richTextExample());
    // As Postgres jsonb hands it back: shorter keys first.
    const reordered = JSON.parse(
      '{"type":"doc","content":[{"type":"paragraph","content":[{"text":"Hi","type":"text","marks":[{"type":"textStyle","attrs":{"color":"blue","fontSize":null}}]}]}]}',
    );
    expect(richTextKey(reordered)).toBe(
      JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "textStyle", attrs: { fontSize: null, color: "blue" } }] }] }],
      }),
    );
    expect(richTextKey(null)).toBe("null");
  });

  it("gives null when nothing is written, or the document is not one", () => {
    for (const blank of [
      doc({ type: "paragraph" }),
      doc({ type: "paragraph", attrs: { textAlign: "center" } }, { type: "paragraph" }),
      doc({ type: "bulletList", content: [li({ type: "paragraph" })] }),
      doc(p(t("\u0000\u0007"))),
      doc({ type: "heading", content: [t("Gone")] }),
      null,
      undefined,
      "<p>Hi</p>",
      { type: "doc" },
      { type: "paragraph", content: [t("a")] },
    ]) {
      expect(toRichTextDoc(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  it("keeps a document that is only line breaks", () => {
    expect(toRichTextDoc(doc(p({ type: "hardBreak" })))).toEqual(doc(p({ type: "hardBreak" })));
  });

  it("drops what the store does not allow and keeps the tokens it does", () => {
    const result = toRichTextDoc(
      doc(
        {
          type: "paragraph",
          attrs: { textAlign: "middle", style: "color:red" },
          content: [
            t("a", [{ type: "textStyle", attrs: { fontSize: "11pt", color: "#000000" } }]),
            t("b", [{ type: "textStyle", attrs: { fontSize: "small", color: "windowtext" } }]),
            t("c", [{ type: "highlight", attrs: { color: "rgb(255, 255, 0)" } }, { type: "highlight", attrs: { color: "pink" } }]),
            { type: "image", attrs: { src: "x.png" } },
            t("d\te\nf"),
          ],
        },
        { type: "blockquote", content: [p(t("quoted"))] },
        { type: "orderedList", attrs: { start: 1 }, content: [li(p(t("one")), { type: "bulletList", content: [li(p(t("nested")))] })] },
        { type: "orderedList", attrs: { start: 123456 }, content: [li(p(t("big")))] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList", content: [] }] }] },
      ),
    );
    expect(result).toEqual(
      doc(
        p(
          t("a"),
          t("b", [{ type: "textStyle", attrs: { fontSize: "small", color: null } }]),
          t("c", [{ type: "highlight", attrs: { color: "yellow" } }]),
          t("d\tef"),
        ),
        { type: "orderedList", content: [li(p(t("one")))] },
        { type: "orderedList", attrs: { start: 9999 }, content: [li(p(t("big")))] },
      ),
    );
    expect(RichTextDocSchema.safeParse(result).success).toBe(true);
  });

  it("joins neighbouring text with the same marks, as the editor does", () => {
    const bold = [{ type: "bold" }];
    expect(toRichTextDoc(doc(p(t("a", bold), t("b", [{ type: "bold" }, { type: "link" }]), t("c"))))).toEqual(doc(p(t("ab", bold), t("c"))));
  });

  it("takes half an emoji out, as Postgres would refuse it", () => {
    expect(toRichTextDoc(doc(p(t("ok 😀 \ud83d"))))).toEqual(doc(p(t("ok 😀 "))));
  });

  it("cuts a document past the limits, which the editor never lets happen", () => {
    const long = toRichTextDoc(doc(p(t("a".repeat(RICH_TEXT_MAX_CHARACTERS - 1))), p(t("bcd")), p(t("gone")), { type: "bulletList", content: [li(p(t("gone too")))] }));
    expect(long && richTextLength(long)).toBe(RICH_TEXT_MAX_CHARACTERS);
    // Cut where the characters run out: nothing after it stays, not even empty lines.
    expect(long?.content).toHaveLength(2);
    expect(long?.content[1]).toEqual(p(t("b")));
    const many = toRichTextDoc(doc(...Array.from({ length: RICH_TEXT_MAX_PARAGRAPHS + 20 }, (_, index) => p(t(`line ${index}`)))));
    expect(many && richTextParagraphs(many)).toHaveLength(RICH_TEXT_MAX_PARAGRAPHS);
    const emoji = toRichTextDoc(doc(p(t(`${"a".repeat(RICH_TEXT_MAX_CHARACTERS - 1)}😀`))));
    expect(emoji && richTextLength(emoji)).toBe(RICH_TEXT_MAX_CHARACTERS - 1);
  });

  it("always gives a document the store accepts", () => {
    const inputs: unknown[] = [
      editorJson(),
      doc(p(t("x".repeat(RICH_TEXT_MAX_CHARACTERS + 50)))),
      doc(...Array.from({ length: 600 }, () => ({ type: "bulletList", content: [li(p(t("i"))), li({ type: "paragraph" })] }))),
      doc(p(t("a", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "highlight" }, { type: "textStyle", attrs: { fontSize: "large" } }, { type: "code" }]))),
      doc({ type: "paragraph", content: "not a list" }, { type: "orderedList", attrs: { start: "7" }, content: [li(p(t("s")))] }),
    ];
    for (const input of inputs) {
      const result = toRichTextDoc(input);
      expect(result).not.toBeNull();
      expect(RichTextDocSchema.safeParse(result).success).toBe(true);
    }
  });
});

describe("richTextPlain", () => {
  it("joins paragraphs by a blank line and lists by line, ignoring the formatting", () => {
    expect(richTextPlain(richTextExample())).toBe(RICH_TEXT_EXAMPLE_TEXT);
  });

  it("numbers items from the list's start by their place, indents a line break inside an item, and drops empty lines", () => {
    const summary: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "  Released " }, { type: "hardBreak" }, { type: "text", text: "with notes" }] },
        { type: "paragraph" },
        {
          type: "orderedList",
          attrs: { start: 4 },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
            { type: "listItem", content: [{ type: "paragraph" }] },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Third" }, { type: "hardBreak" }, { type: "text", text: "more" }] }],
            },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "End." }] },
      ],
    };
    expect(richTextPlain(summary)).toBe("Released \nwith notes\n\n4. First\n6. Third\n  more\n\nEnd.");
  });
});

describe("richTextHtml", () => {
  it("writes the example with only the fixed styles", () => {
    expect(richTextHtml(richTextExample())).toBe(RICH_TEXT_EXAMPLE_HTML);
  });

  it("escapes every written character that could start markup or leave an attribute", () => {
    const html = richTextHtml(richTextParagraph(`<script>alert("x")</script> & 'quoted'`));
    expect(html).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;</p>");
  });

  it("uses only the allowed tags and attributes, whatever the document holds", () => {
    const everything: RichTextDoc = {
      type: "doc",
      content: [
        ...richTextExample().content,
        {
          type: "paragraph",
          attrs: { textAlign: "justify" },
          content: [
            {
              type: "text",
              text: 'x" onload="alert(1)',
              marks: [
                { type: "textStyle", attrs: { fontSize: "small", color: null } },
                { type: "bold" },
                { type: "italic" },
                { type: "strike" },
                { type: "underline" },
                { type: "highlight", attrs: { color: "pink" } },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "r" }] }] }],
        },
      ],
    };
    const html = richTextHtml(everything);
    const tags = [...html.matchAll(/<\/?([a-z]+)([^>]*)>/g)];
    for (const [, tag, attributes] of tags) {
      expect(["p", "br", "ul", "ol", "li", "span", "mark", "strong", "em", "u", "s"]).toContain(tag);
      const names = [...attributes.matchAll(/\s([a-z-]+)=/g)].map((match) => match[1]);
      for (const name of names) expect(name === "style" || (tag === "ol" && name === "start"), `${tag} ${name}`).toBe(true);
    }
    expect(html).toContain('<li style="text-align:right">r</li>');
    expect(html).toContain("<ol><li");
    expect(html).toContain(
      '<span style="font-size:0.875em"><mark style="background-color:#fce7f3;color:inherit"><strong><em><u><s>x&quot; onload=&quot;alert(1)</s></u></em></strong></mark></span>',
    );
  });
});

describe("palette", () => {
  const grounds = { white: "#ffffff", "slate-100": "#f1f5f9", ...RICH_TEXT_HIGHLIGHT_HEX };

  it.each(RICH_TEXT_COLOURS)("%s text holds 4.5:1 on white, slate-100 and every highlight", (colour) => {
    for (const [name, ground] of Object.entries(grounds)) {
      expect(contrastRatio(RICH_TEXT_COLOUR_HEX[colour], ground), `${colour} on ${name}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("names every token", () => {
    expect(Object.keys(RICH_TEXT_COLOUR_HEX)).toEqual([...RICH_TEXT_COLOURS]);
    expect(Object.keys(RICH_TEXT_HIGHLIGHT_HEX)).toEqual([...RICH_TEXT_HIGHLIGHTS]);
  });
});
