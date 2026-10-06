// Server-rendered markup of the capture body: the template's wording, only
// the ordered sizes, the grid with its computed footer, read-only text, the
// lab report state and the notices. Key, paste and focus handling are the
// kit's (components/qc), tested there; the edits are pure (edit.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluateInspection, type CaptureProps, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { ForceAtBreakComputed } from "./calc";
import Capture from "./Capture";
import { FORCE_AT_BREAK_DEFAULT_CONFIG, FORCE_AT_BREAK_LABELS, FORCE_AT_BREAK_TITLE, type ForceAtBreakConfig } from "./config";
import type { ForceAtBreakData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";
/** 13 readings with the STD_EG example's median, 6.537 N. */
const READINGS = [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79, 6.512, 6.611, 6.42, 6.702, 6.388, 6.58];

const CONTEXT = makeTestContext({
  sizes: ["M", "L"],
  sampling: { M: makeSampling({ physical: 13 }), L: makeSampling({ physical: 5 }) },
});

type Props = CaptureProps<ForceAtBreakData, ForceAtBreakConfig, ForceAtBreakComputed>;

function evaluationOf(data: ForceAtBreakData, context: InspectionContext, config: ForceAtBreakConfig) {
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "force_at_break", config }]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { force_at_break: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "force_at_break");
  return (evaluation ?? null) as ModuleEvaluation<ForceAtBreakComputed> | null;
}

function render(overrides: Partial<Props> = {}): string {
  const data = overrides.data ?? { sizes: { M: { values: READINGS } }, labReport: null };
  const context = overrides.context ?? CONTEXT;
  const config = overrides.config ?? FORCE_AT_BREAK_DEFAULT_CONFIG;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={FORCE_AT_BREAK_TITLE}
      labels={FORCE_AT_BREAK_LABELS}
      context={context}
      evaluation={evaluationOf(data, context, config)}
      focusPath={null}
      readOnly={false}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

const tags = (html: string, pattern: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${pattern}[^>]*>`, "g")), (match) => match[0]);

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const POSITIONING = ["relative", "absolute", "fixed", "sticky", "sr-only"];

/** sr-only elements with no positioned ancestor: they lay out against the page (docs/DESIGN.md, D1). */
function unanchoredSrOnly(html: string): string[] {
  const open: { tag: string; positioned: boolean }[] = [];
  const found: string[] = [];
  for (const [, closing, tag, attributes, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (closing) {
      const index = open.map((element) => element.tag).lastIndexOf(tag);
      if (index !== -1) open.length = index;
      continue;
    }
    const classes = (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/);
    if (classes.includes("sr-only") && !open.some((element) => element.positioned)) found.push(`<${tag}${attributes}>`);
    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
    open.push({ tag, positioned: classes.some((name) => POSITIONING.includes(name)) });
  }
  return found;
}

describe("force_at_break capture", () => {
  it("shows a tab for each ordered size only, with calc's result on it (6.2 rule 4)", () => {
    const html = render();
    const tabs = tags(html, 'role="tab"');
    expect(tabs.map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["M", "L"]);
    const chips = tags(html, 'data-slot="result-chip"').map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1]);
    expect(chips).toEqual(["pass", "not_done"]);
    expect(html).toContain(`aria-label="${FORCE_AT_BREAK_TITLE}: sizes"`);
  });

  it("lays the size's readings out in the grid, one cell per glove tested, with the template's wording", () => {
    const html = render();
    expect(html).toContain(`<caption class="sr-only">${FORCE_AT_BREAK_TITLE}, size M</caption>`);
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(13);
    expect(cells[0]).toContain('aria-label="Force at break (N), No. 1"');
    expect(cells[0]).toContain('inputMode="decimal"');
    expect(cells[0]).toContain('value="6.470"');
    for (const label of ["Median", "Spec.", "Passed / Failed"]) expect(html).toContain(`>${label}</th>`);
    // The median is computed in the footer, never typed (6.2 rule 2).
    expect(html).toContain(">6.537<");
    expect(html).toContain("13 gloves tested, from the sampling plan.");
  });

  it("takes n from the template when the sampling plan gives none", () => {
    const context = makeTestContext({ sizes: ["M"] });
    const html = render({ context, config: { ...FORCE_AT_BREAK_DEFAULT_CONFIG, n: 7 } });
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(7);
    expect(html).toContain("7 gloves tested: the template&#x27;s number until the sampling plan gives one.");
  });

  it("uses the template's labels and standard, never wording of its own (6.2 rule 11)", () => {
    const labels = { ...FORCE_AT_BREAK_LABELS, values: "FAB (N)", median: "Median value", labReport: "Test report" };
    const html = render({ labels, config: { ...FORCE_AT_BREAK_DEFAULT_CONFIG, standardLabel: "EN 455" } });
    expect(html).toContain('aria-label="FAB (N), No. 1"');
    expect(html).toContain(">Median value</th>");
    expect(html).toContain(">Spec. (EN 455)</th>");
    expect(html).toContain(">Test report</span>");
  });

  it("says whether the lab report is attached", () => {
    expect(render()).toMatch(/>Lab report<\/span><span class="text-muted-foreground">Not attached</);
    const attached = render({ data: { sizes: { M: { values: READINGS } }, labReport: LAB_REPORT_ID } });
    expect(attached).toContain('data-attached="true"');
    expect(attached).toContain(">Attached</span>");
  });

  it("shows readings as text when read-only, with the computed footer", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("<input");
    expect(html).toContain(">6.470</td>");
    expect(html).toContain(">6.537<");
    expect(tags(html, 'data-slot="status-pill"').map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1])).toEqual(["pass"]);
  });

  it("lists readings past the gloves tested, with calc's message and a way to clear them", () => {
    const data = { sizes: { M: { values: [...READINGS, null, 6.1, 6.3] } }, labReport: null };
    const html = render({ data });
    expect(html).toContain("Size M: 2 readings are entered beyond the 13 gloves tested. Clear them or correct the sampling plan.");
    expect(html).toContain("No. 15: 6.1 N, No. 16: 6.3 N");
    expect(html).toContain(">Clear the 2 extra readings</button>");
    expect(render({ data, readOnly: true })).not.toContain("Clear the 2 extra readings");
  });

  it("explains a size the sampling plan gives no gloves to test", () => {
    const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 0 }) } });
    const html = render({ context, data: { sizes: {}, labReport: null } });
    expect(html).toContain("No gloves to test in the sampling plan for size M.");
    expect(html).not.toContain("<input");
  });

  it("still shows readings saved for a size the plan now gives no gloves, with calc's error and a way to clear them", () => {
    const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 0 }) } });
    const html = render({ context, data: { sizes: { M: { values: [6.5, 6.6] } }, labReport: null } });
    expect(html).toContain("No gloves to test in the sampling plan for size M.");
    expect(html).toContain("Size M: 2 readings are entered beyond the 0 gloves tested. Clear them or correct the sampling plan.");
    expect(html).toContain(">Clear the 2 extra readings</button>");
    // The issue link lands on the notice.
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;values&quot;]"');
  });

  it("says no sizes are ordered yet instead of showing a grid", () => {
    const html = render({ context: makeTestContext({ sizes: [] }), data: { sizes: {}, labReport: null } });
    expect(html).toContain("No sizes ordered yet.");
    expect(html).not.toContain('role="tab"');
  });

  it("marks the lab report and the size panel for issue links", () => {
    const html = render();
    expect(html).toContain('data-issue-path="[&quot;labReport&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;]"');
  });

  it("keeps its screen-reader text inside a positioned box (docs/DESIGN.md, D1)", () => {
    expect(unanchoredSrOnly(render())).toEqual([]);
    expect(unanchoredSrOnly(render({ readOnly: true }))).toEqual([]);
  });
});
