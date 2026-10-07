// Server-rendered markup of the conclusion capture, from a real evaluation
// with the labelling module beside it, and of its signature pad. Drawing is
// pointer-driven in the browser; the edits are in edit.ts, the stroke
// geometry in signature.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import Capture, { SignaturePad } from "./Capture";
import type { ConclusionComputed } from "./calc";
import { CONCLUSION_DEFAULT_CONFIG, CONCLUSION_LABELS } from "./config";
import { emptyConclusion, type ConclusionData } from "./schema";
import { addStroke, strokePath } from "./signature";

const noop = () => {};
const SIGNED = addStroke(addStroke(null, [40, 150, 90, 60, 140, 150]), [200, 100]);

type Options = {
  defects?: number;
  /** "off" switches the labelling module off, so no module has a result. */
  labeling?: "on" | "off";
  labels?: Readonly<Record<string, string>>;
  context?: InspectionContext;
  readOnly?: boolean;
};

function render(
  data: Partial<ConclusionData>,
  {
    defects = 0,
    labeling: switched = "on",
    labels = CONCLUSION_LABELS,
    context = makeTestContext({ sizes: ["M"] }),
    readOnly = false,
  }: Options = {},
): string {
  const conclusion = { ...emptyConclusion(), ...data };
  const template = makeTestTemplate(MODULE_REGISTRY, [
    { key: "header", include: false },
    switched === "on" ? "labeling" : { key: "labeling", include: false },
    { key: "conclusion", labels },
  ]);
  const labeling = { sizes: { M: { inner: { inspected: 3, defects: { lot_no: defects } }, carton: { inspected: 1 } } } };
  const evaluation = evaluateInspection(
    { template, data: { modules: { labeling, conclusion }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "conclusion") as ModuleEvaluation<ConclusionComputed>;
  return renderToStaticMarkup(
    <Capture
      data={conclusion}
      config={CONCLUSION_DEFAULT_CONFIG}
      title="Conclusion"
      labels={labels}
      context={context}
      evaluation={evaluation}
      focusPath={null}
      readOnly={readOnly}
      onChange={noop}
    />,
  );
}

function renderPad(props: Partial<Parameters<typeof SignaturePad>[0]> = {}) {
  return renderToStaticMarkup(<SignaturePad value={null} onChange={noop} label="Signature" {...props} />);
}

const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** What each status pill says, in order. */
const pillLabels = (html: string): string[] =>
  Array.from(html.matchAll(/data-slot="status-pill"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span>([^<]*)<\/span>/g), (match) => match[1]);

/** The suggested result's box. */
const suggestedBox = (html: string): string => /<section[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";

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
    expect(html).toContain("Suggested result");
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
    expect(pillLabels(nothing)).toEqual(["On hold"]);
    expect(suggestedBox(nothing).match(/No module has a result yet\./g)).toHaveLength(1);
  });

  it("names the modules behind the suggestion by the template's titles", () => {
    const context = makeTestContext({
      sizes: ["M"],
      modules: [
        { key: "labeling", title: "Packaging Labeling Inspection" },
        { key: "conclusion", title: "Conclusion" },
      ],
    });
    expect(render({}, { defects: 1, context })).toContain("Failed: Packaging Labeling Inspection.");
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

  it("flags a final result that contradicts the suggestion, as a warning beside the choice", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12" }, { defects: 1 });
    expect(html).toContain(
      "Conclusion PASSED differs from the suggestion, FAILED (failed: Labeling). Explain why under Remark.",
    );
    // The choice is described by the warning, so a screen reader hears it with the result.
    const describedBy = /role="radiogroup"[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toMatch(new RegExp(`<p id="${describedBy}"[^>]*>(<svg[\\s\\S]*?</svg>)?Conclusion PASSED differs`));
    const agreed = render({ finalResult: "fail", date: "2025-04-12" }, { defects: 1 });
    expect(agreed).not.toContain("differs from");
    expect(agreed).not.toMatch(/role="radiogroup"[^>]*aria-describedby=/);
  });

  it("shows who inspected, from the inspection, and the date from the picker", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12", remark: "Released." });
    expect(html).toMatch(/<input[^>]*readonly=""[^>]*value="Inspector A"/i);
    expect(html).toContain("Inspected by");
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2025-04-12"/);
    expect(html).toContain("Released.</textarea>");
    const nobody = makeTestContext({ sizes: ["M"], inspection: { ...makeTestContext().inspection, inspector: null } });
    expect(render({}, { context: nobody })).toMatch(/<input[^>]*readonly=""[^>]*value="Not recorded"/i);
  });

  it("A. SAFEDON_EG: Inspected by beside the signature is the inspection's inspector; result and date as printed", () => {
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

  it("marks the fields for the links in the issue list", () => {
    const paths = tagsWith(render({}), "data-issue-path").map((tag) => /data-issue-path="([^"]+)"/.exec(tag)?.[1]);
    expect(paths).toEqual(
      ['["finalResult"]', '["remark"]', '["date"]', '["signature"]'].map((path) => path.replaceAll('"', "&quot;")),
    );
  });

  it("is read-only for an approved inspection", () => {
    const html = render({ finalResult: "pass", date: "2025-04-12", remark: "Released.", signature: SIGNED }, { readOnly: true });
    expect(radios(html).every((radio) => radio.disabled)).toBe(true);
    expect(radios(html).find((radio) => radio.checked)?.value).toBe("pass");
    expect(html).toMatch(/<textarea[^>]*readonly=""/i);
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
    expect(renderPad()).toContain("Sign in the box with a finger, a pen or the mouse.");
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
