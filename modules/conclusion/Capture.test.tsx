// Server-rendered markup of the conclusion capture, from a real evaluation
// with the labelling module beside it, and of its signature pad. Drawing is
// pointer-driven in the browser; the edits are in edit.ts, the stroke
// geometry in signature.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { richTextExample } from "@/lib/rich-text/__fixtures__/example";
import { SummaryAssistProvider, type SummaryAssist } from "@/modules/_framework/summary-assist";
import Capture, { SignaturePad } from "./Capture";
import type { ConclusionComputed } from "./calc";
import { CONCLUSION_DEFAULT_CONFIG, CONCLUSION_LABELS } from "./config";
import { emptyConclusion, type ConclusionData } from "./schema";
import { addStroke, MAX_STROKES, strokePath } from "./signature";

const noop = () => {};
const SIGNED = addStroke(addStroke(null, [40, 150, 90, 60, 140, 150]), [200, 100]);
/** A pad with no room for another stroke. */
const FULL = { width: 600, height: 200, strokes: Array.from({ length: MAX_STROKES }, (_, index) => [index, 10, index + 1, 20]) };

type Options = {
  defects?: number;
  /** "off" switches the labelling module off, so no module has a result; "blank" leaves it not done. */
  labeling?: "on" | "off" | "blank";
  /** More modules in the template, left blank, so not done. */
  blank?: readonly ModuleKey[];
  title?: string;
  labels?: Readonly<Record<string, string>>;
  context?: InspectionContext;
  readOnly?: boolean;
  /**
   * The conclusion as last evaluated, when it is a render behind the one
   * shown (the capture screen evaluates a deferred copy: useDeferredValue).
   */
  evaluated?: Partial<ConclusionData>;
  /** The screen's Steri-AI Summary slot; left out, as in the template editor's preview. */
  assist?: SummaryAssist | null;
};

/** The capture screen's slot, never called on the server. */
const ASSIST: SummaryAssist = {
  menu: { length: "standard", paragraphs: "auto", format: "paragraphs", language: "en-GB", languagesOffered: ["en-GB"], inspectorsCanAdjust: true },
  draft: async () => ({ ok: false, reason: "error", message: "Not called on the server." }),
  basisNow: () => "0000000000000000",
  inspectionId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};

function render(
  data: Partial<ConclusionData>,
  {
    defects = 0,
    labeling: switched = "on",
    blank = [],
    title = "Conclusion",
    labels = CONCLUSION_LABELS,
    context = makeTestContext({ sizes: ["M"] }),
    readOnly = false,
    evaluated,
    assist,
  }: Options = {},
): string {
  const conclusion = { ...emptyConclusion(), ...data };
  const template = makeTestTemplate(MODULE_REGISTRY, [
    { key: "header", include: false },
    switched === "off" ? { key: "labeling", include: false } : "labeling",
    ...blank,
    { key: "conclusion", labels },
  ]);
  const labeling = { sizes: { M: { inner: { inspected: 3, defects: { lot_no: defects } }, carton: { inspected: 1 } } } };
  const shown = evaluated ? { ...emptyConclusion(), ...evaluated } : conclusion;
  const modules = switched === "blank" ? { conclusion: shown } : { labeling, conclusion: shown };
  const evaluation = evaluateInspection(
    { template, data: { modules, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "conclusion") as ModuleEvaluation<ConclusionComputed>;
  const capture = (
    <Capture
      data={conclusion}
      config={CONCLUSION_DEFAULT_CONFIG}
      title={title}
      labels={labels}
      context={context}
      evaluation={evaluation}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
    />
  );
  return renderToStaticMarkup(assist === undefined ? capture : <SummaryAssistProvider value={assist}>{capture}</SummaryAssistProvider>);
}

function renderPad(props: Partial<Parameters<typeof SignaturePad>[0]> = {}) {
  return renderToStaticMarkup(<SignaturePad value={null} onChange={noop} label="Signature" {...props} />);
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** What each status pill says, in order. */
const pillLabels = (html: string): string[] =>
  Array.from(html.matchAll(/data-slot="status-pill"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span>([^<]*)<\/span>/g), (match) => match[1]);

/** The suggested result's line, the section names under Show All included. */
const suggestedBox = (html: string): string => /<section[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";

/** The remark's opening tag. */
const remarkTag = (html: string): string => /<textarea[^>]*>/.exec(html)?.[0] ?? "";

const radios = (html: string) =>
  tagsWith(html, 'role="radio"').map((tag) => ({
    value: /value="([a-z]+)"/.exec(tag)?.[1],
    checked: tag.includes('aria-checked="true"'),
    disabled: /\sdisabled=""/.test(tag),
  }));

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/g)].map(
    ([tag, text]) =>
      `${text}${/\saria-disabled="true"/.test(tag) ? " (unavailable)" : ""}${/\sdisabled=""/.test(tag) ? " (disabled)" : ""}`,
  );

describe("conclusion capture", () => {
  it("shows the suggested result as every result pill says it, with the modules behind it", () => {
    const html = render({}, { defects: 1 });
    expect(html).toContain("Suggested Result");
    expect(tagsWith(html, 'data-slot="status-pill"')[0]).toContain('data-status="fail"');
    expect(pillLabels(html)).toEqual(["Failed"]);
    expect(html).toContain("Failed: Labeling.");
    // The template's word is the choice's, not the pill's (docs/DESIGN.md, Status colours).
    expect(html.match(/FAILED/g)).toHaveLength(1);
  });

  it("adds nothing under a clean pass, and says once why a suggestion is on hold", () => {
    const passed = render({});
    expect(pillLabels(passed)).toEqual(["Passed"]);
    expect(suggestedBox(passed)).not.toContain("<ul");
    const nothing = render({}, { labeling: "off" });
    expect(pillLabels(nothing)).toEqual(["On Hold"]);
    expect(suggestedBox(nothing).match(/No module has a result yet\./g)).toHaveLength(1);
  });

  it("names the modules behind the suggestion by their short names, as the menus do, whatever the template's titles", () => {
    const context = makeTestContext({
      sizes: ["M"],
      modules: [
        { key: "labeling", title: "Packaging Labeling Inspection" },
        { key: "conclusion", title: "Conclusion" },
      ],
    });
    const html = render({}, { defects: 1, context });
    expect(suggestedBox(html)).toContain("<p class=\"min-w-0\">Failed: Labeling.</p>");
    // The title stays with calc's summary, the review and the export (docs/DESIGN.md, Step Names).
    expect(html).not.toContain("Packaging Labeling Inspection");
  });

  it("names a reason's one section on the line, with nothing to open", () => {
    const box = suggestedBox(render({}, { labeling: "blank" }));
    expect(pillLabels(box)).toEqual(["On Hold"]);
    expect(box).toContain("<p class=\"min-w-0\">Not done: Labeling.</p>");
    expect(box).not.toContain("<button");
    expect(box).not.toContain("<ul");
  });

  it("counts two or more sections, their names under Show All, folded at first", () => {
    const box = suggestedBox(render({}, { labeling: "blank", blank: ["visual"] }));
    expect(box).toContain("<p class=\"min-w-0\">Not done: 2 sections.</p>");
    const button = /<button[^>]*>Show All<\/button>/.exec(box)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(controls).toBeDefined();
    // Word for word as the submit dialog says it, by their short names, once.
    expect(box).toMatch(new RegExp(`<ul id="${controls}" hidden=""[^>]*><li>Not done: Labeling, Visual Inspection\\.</li></ul>`));
    expect(box.match(/Labeling/g)).toHaveLength(1);
  });

  it("names the choice by its label, shown only when it does not repeat the card's title", () => {
    const label = (html: string) => {
      const id = /role="radiogroup"[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
      const [, classes = "", text] = new RegExp(`<span id="${id}" class="([^"]*)">([^<]*)</span>`).exec(html) ?? [];
      return { text, hidden: classes.split(" ").includes("sr-only") };
    };
    expect(label(render({}))).toEqual({ text: "Conclusion", hidden: true });
    const relabelled = { ...CONCLUSION_LABELS, finalResult: "Final result" };
    expect(label(render({}, { labels: relabelled }))).toEqual({ text: "Final result", hidden: false });
    expect(label(render({}, { labels: relabelled, title: "Final Result" }))).toEqual({ text: "Final result", hidden: true });
  });

  it("keeps the blocking not-done error, which links to the choice, out of the choice's own warning", () => {
    const html = render({});
    expect(html).not.toContain("must be complete before submit");
    expect(html).not.toMatch(/role="radiogroup"[^>]*aria-describedby=/);
    expect(render({ finalResult: "pass" })).not.toContain("must be complete before submit");
  });

  it("offers pass, fail and hold as one choice, in the template's words", () => {
    const html = render({ finalResult: "hold", date: "2025-04-12" });
    expect(html).toMatch(/role="radiogroup"[^>]*aria-labelledby="[^"]+"/);
    expect(radios(html)).toEqual([
      { value: "pass", checked: false, disabled: false },
      { value: "fail", checked: false, disabled: false },
      { value: "hold", checked: true, disabled: false },
    ]);
    for (const word of ["PASSED", "FAILED", "HOLD"]) expect(html).toContain(word);
    const relabelled = render({}, { labels: { ...CONCLUSION_LABELS, pass: "ACCEPTED", finalResult: "Final result" } });
    expect(relabelled).toContain("ACCEPTED");
    expect(relabelled).toContain("Final result");
  });

  it("flags a final result that contradicts the suggestion, as a warning under the remark", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12" }, { defects: 1 });
    // The choice and the remark are described by one note, so a screen reader hears it with either.
    const describedBy = /role="radiogroup"[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(remarkTag(html)).toContain(`aria-describedby="${describedBy}"`);
    // Short: the pill just above gives the suggestion and why. It asks for the reason, with an amber edge.
    expect(html).toMatch(
      new RegExp(`<p id="${describedBy}"[^>]*>(<svg[\\s\\S]*?</svg>)?<span>PASSED differs from the suggestion\\. Explain why\\.</span></p>`),
    );
    expect(remarkTag(html)).toContain("border-warn-solid");
    // calc's full message is for Pending, the review and the export.
    expect(html).not.toContain("Explain why under Remark.");
    // Once there is a remark, or read-only: the note alone, the edge as every field's.
    for (const settled of [
      render({ finalResult: "pass", date: "2025-04-12", remark: "Released." }, { defects: 1 }),
      render({ finalResult: "pass", date: "2025-04-12" }, { defects: 1, readOnly: true }),
    ]) {
      expect(settled).toContain("<span>PASSED differs from the suggestion.</span>");
      expect(remarkTag(settled)).not.toContain("border-warn-solid");
    }
    const agreed = render({ finalResult: "fail", date: "2025-04-12" }, { defects: 1 });
    expect(agreed).not.toContain("differs from");
    expect(agreed).not.toMatch(/role="radiogroup"[^>]*aria-describedby=/);
    expect(remarkTag(agreed)).not.toContain("aria-describedby");
  });

  it("never says a choice that agrees with the suggestion differs, while the evaluation is a render behind", () => {
    // Just after FAILED replaces PASSED, the screen's deferred evaluation still holds calc's warning for PASSED.
    const evaluated = { finalResult: "pass", date: "2025-04-12" } as const;
    const agreed = render({ finalResult: "fail", date: "2025-04-12" }, { defects: 1, evaluated });
    expect(agreed).not.toContain("differs from");
    expect(agreed).not.toMatch(/role="radiogroup"[^>]*aria-describedby=/);
    expect(remarkTag(agreed)).not.toContain("border-warn-solid");
    // A choice that differs too is named as shown.
    const held = render({ finalResult: "hold", date: "2025-04-12" }, { defects: 1, evaluated });
    expect(held).toContain("<span>HOLD differs from the suggestion. Explain why.</span>");
  });

  it("shows who inspected, from the inspection, and the date from the picker", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12", remark: "Released." });
    expect(html).toMatch(/<input[^>]*readonly=""[^>]*value="Inspector A"/i);
    expect(html).toContain("Inspected By");
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2025-04-12"/);
    expect(html).toContain("Released.</textarea>");
    const nobody = makeTestContext({ sizes: ["M"], inspection: { ...makeTestContext().inspection, inspector: null } });
    expect(render({}, { context: nobody })).toMatch(/<input[^>]*readonly=""[^>]*value="Not recorded"/i);
  });

  it("A. SAFEDON_EG: Inspected By beside the signature is the inspection's inspector; result and date as printed", () => {
    const { conclusion } = SAFEDON_EG_EXAMPLE;
    const inspectedBy = conclusion.inspectedBy!;
    const context = makeTestContext({
      sizes: ["M"],
      inspection: { ...makeTestContext().inspection, inspector: { id: TEST_INSPECTOR.id, name: inspectedBy } },
    });
    const html = render({ finalResult: "pass", date: conclusion.date.iso, signature: SIGNED }, { context });
    expect(CONCLUSION_LABELS.pass).toBe(conclusion.printedResult);
    expect(radios(html).find((radio) => radio.checked)?.value).toBe("pass");
    expect(html).toMatch(new RegExp(`<input[^>]*readonly=""[^>]*value="${inspectedBy}"`, "i"));
    expect(html).toContain(`Signed by ${inspectedBy}.`);
    expect(html).toMatch(new RegExp(`<input[^>]*type="date"[^>]*value="${conclusion.date.iso}"`));
  });

  it("warns under the date when it is before the inspection date", () => {
    const context = makeTestContext({ sizes: ["M"], header: { ...makeTestContext().header, inspectionDate: "2025-04-11" } });
    expect(render({ finalResult: "pass", date: "2025-04-10" }, { context })).toContain(
      "Date 2025-04-10 is before the inspection date, 2025-04-11.",
    );
  });

  it("has the signature pad, signed by the inspector", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12", signature: SIGNED });
    expect(html).toContain('data-slot="signature-pad"');
    expect(html).toContain("Signed by Inspector A.");
  });

  it("says who signed to screen readers only: Inspected By shows the name just above", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12", signature: SIGNED });
    // Nothing else to show: the whole line is screen-reader text, so it leaves no gap under the pad.
    expect(html).toMatch(/<p id="[^"]+" class="[^"]*\bsr-only\b[^"]*"><span class="sr-only">Signed by Inspector A\.<\/span><\/p>/);
  });

  it("marks the fields for the links in the issue list", () => {
    const paths = tagsWith(render({}), "data-issue-path").map((tag) => /data-issue-path="([^"]+)"/.exec(tag)?.[1]);
    expect(paths).toEqual(
      ['["finalResult"]', '["remark"]', '["inspectionSummary"]', '["date"]', '["signature"]'].map((path) =>
        path.replaceAll('"', "&quot;"),
      ),
    );
  });

  it("puts the inspection summary after the remark and before the sign-off, so Tab reads in order", () => {
    const html = render({});
    const at = (marker: string) => {
      const index = html.indexOf(marker);
      expect(index, marker).toBeGreaterThanOrEqual(0);
      return index;
    };
    const remark = at("<textarea");
    const summary = at('aria-label="Formatting"');
    const inspectedBy = at(">Inspected By</label>");
    expect(remark).toBeLessThan(summary);
    expect(summary).toBeLessThan(inspectedBy);
    // Three rows, none beside another: the decision (the remark beside the choice from 896 px), the summary
    // across the whole card under a hairline, then the sign-off under a hairline (side by side from 896 px).
    expect(html).toMatch(/^<div class="relative min-w-0 @container"><div class="grid gap-6"><div class="grid min-w-0 gap-6 @4xl:grid-cols-2 @4xl:gap-x-10">/);
    expect(html).toMatch(/<div role="group" aria-labelledby="[^"]+" class="min-w-0 space-y-2 border-t border-border pt-6">/);
    expect(html).toMatch(/<div class="min-w-0 space-y-6 border-t border-border pt-6 @4xl:grid @4xl:grid-cols-2 @4xl:gap-x-10 @4xl:space-y-0">[\s\S]*Inspected By/);
  });

  it("heads the summary with the template's words, a group around its toolbar and text", () => {
    const named = (html: string) => {
      const id = /<div role="group" aria-labelledby="([^"]+)" class="[^"]*border-t/.exec(html)?.[1];
      return new RegExp(`<h3 id="${id}"[^>]*>([^<]*)</h3>`).exec(html)?.[1];
    };
    expect(named(render({}))).toBe("Inspection Summary");
    expect(named(render({}, { labels: { ...CONCLUSION_LABELS, inspectionSummary: "Inspector's Summary" } }))).toBe("Inspector&#x27;s Summary");
  });

  it("keeps the summary's heading row a button tall, with room at its right end", () => {
    const row = /<div data-slot="summary-heading" class="([^"]*)"><h3 [^>]*>Inspection Summary<\/h3><\/div>/.exec(render({}))?.[1].split(" ");
    expect(row).toEqual(expect.arrayContaining(["flex", "min-h-8", "touch:min-h-11", "items-center", "justify-between"]));
  });

  it("puts the Steri-AI Summary button at the heading row's right end, and its line under the editor, where the screen gives the slot", () => {
    const html = render({ finalResult: "pass" }, { assist: ASSIST });
    const row = /<div data-slot="summary-heading" class="[^"]*">([\s\S]*?)<\/div><div data-slot="rich-text-editor"/.exec(html)?.[1] ?? "";
    expect(row).toMatch(/^<h3 [^>]*>Inspection Summary<\/h3><div role="group" aria-label="Steri-AI Summary" data-slot="steri-ai-summary"/);
    const main = /<button[^>]*data-action="steri-ai-summary"[^>]*>/.exec(html)?.[0] ?? "";
    expect(main).not.toMatch(/\saria-disabled="true"/);
    // The line under the editor, before the sign-off; a live region from the start.
    const at = (marker: string) => html.indexOf(marker);
    expect(at('data-slot="rich-text-editor"')).toBeLessThan(at('data-slot="steri-ai-summary-status"'));
    expect(at('data-slot="steri-ai-summary-status"')).toBeLessThan(at(">Inspected By</label>"));
    expect(html).toContain('aria-live="polite" data-slot="steri-ai-summary-announcement"');
  });

  it("greys Steri-AI Summary out until the conclusion is chosen, still focusable", () => {
    const main = /<button[^>]*data-action="steri-ai-summary"[^>]*>/.exec(render({}, { assist: ASSIST }))?.[0] ?? "";
    expect(main).toMatch(/\saria-disabled="true"/);
    expect(main).not.toMatch(/\sdisabled=""/);
  });

  it("shows no Steri-AI Summary read-only, or where the screen gives no slot", () => {
    for (const html of [
      render({ finalResult: "pass" }, { assist: ASSIST, readOnly: true }),
      render({ finalResult: "pass" }, { assist: null }),
      render({ finalResult: "pass" }),
    ]) {
      expect(html).not.toContain("steri-ai-summary");
      expect(html).not.toContain("Steri-AI");
    }
  });

  it("shows the saved summary formatted, in a white frame with its toolbar", () => {
    const html = render({ inspectionSummary: richTextExample() });
    expect(html).toContain('<p class="text-center"><strong>Shipment </strong>');
    expect(html).toMatch(/<div role="toolbar"[^>]*aria-label="Formatting"/);
    expect(html).toContain('data-slot="rich-text-editor"');
  });

  it("is read-only for an approved inspection", () => {
    const html = render(
      { finalResult: "pass", date: "2025-04-12", remark: "Released.", inspectionSummary: richTextExample(), signature: SIGNED },
      { readOnly: true },
    );
    expect(radios(html).every((radio) => radio.disabled)).toBe(true);
    expect(radios(html).find((radio) => radio.checked)?.value).toBe("pass");
    expect(html).toMatch(/<textarea[^>]*readonly=""/i);
    // The summary: the grey read-only box with the formatted text, no toolbar, nothing editable.
    expect(html).not.toContain('role="toolbar"');
    expect(html).toMatch(/<div role="textbox" aria-readonly="true"[^>]*class="[^"]*bg-muted[^"]*"[^>]*><div[^>]*><p class="text-center"><strong>Shipment /);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*readonly=""/i);
    for (const control of ["Undo", "Redo", "Clear"]) expect(html).not.toContain(`</svg>${control}</button>`);
    expect(html).toContain("Signed by Inspector A.");
  });
});

describe("SignaturePad", () => {
  it("draws each stored stroke as an SVG path in the signature's own box", () => {
    const html = renderPad({ value: SIGNED, signer: "Inspector A" });
    expect(html).toContain('viewBox="0 0 600 200"');
    expect(html).toContain(`d="${strokePath(SIGNED.strokes[0])}"`);
    expect(html).toContain(`d="${strokePath(SIGNED.strokes[1])}"`);
    expect(html).toContain("aspect-ratio:600 / 200");
    expect(html).toContain("Signed by Inspector A.");
  });

  it("keeps an older signature's box and proportions", () => {
    const html = renderPad({ value: { width: 800, height: 200, strokes: [[700, 50]] } });
    expect(html).toContain('viewBox="0 0 800 200"');
    expect(html).toContain("aspect-ratio:800 / 200");
  });

  it("offers undo, redo and clear only when there is something to take back", () => {
    // Unavailable, not disabled: a button that greys out under the keyboard keeps the focus.
    expect(buttons(renderPad())).toEqual(["Undo (unavailable)", "Redo (unavailable)", "Clear (unavailable)"]);
    expect(buttons(renderPad({ value: SIGNED }))).toEqual(["Undo", "Redo (unavailable)", "Clear"]);
    expect(renderPad()).toContain("Sign with a finger, a pen or the mouse.");
  });

  it("says visibly when the box is full, after who signed", () => {
    const html = renderPad({ value: FULL, signer: "Inspector A" });
    expect(html).toMatch(
      /<p id="[^"]+" class="text-sm text-muted-foreground touch:text-base"><span class="sr-only">Signed by Inspector A\.<\/span> The box is full: clear it to sign again\.<\/p>/,
    );
    expect(renderPad({ value: FULL, readOnly: true })).not.toContain("The box is full");
  });

  it("sets Undo, Redo and Clear at 16 px on iPad", () => {
    const tags = renderPad({ value: SIGNED }).match(/<button[^>]*>/g) ?? [];
    expect(tags).toHaveLength(3);
    for (const tag of tags) expect(tag).toMatch(/class="[^"]*touch:text-base/);
  });

  it("is named by the template's label and takes every touch for drawing", () => {
    const html = renderPad({ label: "Inspector's signature" });
    const labelId = /role="group" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelId).toBeDefined();
    expect(html).toContain(`id="${labelId}"`);
    expect(html).toContain("Inspector&#x27;s signature");
    expect(html).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    expect(html).toMatch(/<svg[^>]*data-no-swipe=""/);
    expect(html).toMatch(/<svg[^>]*class="[^"]*touch-none/);
  });

  it("shows the strokes read-only, without controls", () => {
    const signed = renderPad({ value: SIGNED, readOnly: true });
    expect(buttons(signed)).toEqual([]);
    expect(signed).toContain(`d="${strokePath(SIGNED.strokes[0])}"`);
    expect(signed).not.toContain("touch-none");
    expect(renderPad({ readOnly: true })).toContain("Not signed.");
  });

  it("anchors its screen-reader text", () => {
    expect(renderPad()).toMatch(/^<div role="group"[^>]*class="relative /);
  });
});
