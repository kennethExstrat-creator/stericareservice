// Server-rendered markup of the capture body: the template's wording, only
// the ordered sizes, the two averages per size with their specs and live
// verdicts, read-only fields, the required lab report and calc's errors.
// Key, paste and focus handling are the kit's (components/qc), tested there;
// the edits are pure (edit.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluateInspection, type CaptureProps, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { TensileComputed } from "./calc";
import Capture from "./Capture";
import { TENSILE_DEFAULT_CONFIG, TENSILE_LABELS, TENSILE_TITLE, type TensileConfig } from "./config";
import type { TensileData } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000402";

/** The SAFEDON_EG example's averages (expected results A). */
const EXAMPLE: TensileData = {
  sizes: {
    XS: { tensileStrength: 34.18, elongationAtBreak: 536 },
    S: { tensileStrength: 32.99, elongationAtBreak: 547 },
    M: { tensileStrength: 34.03, elongationAtBreak: 555 },
    L: { tensileStrength: 33.17, elongationAtBreak: 543 },
  },
  labReport: LAB_REPORT_ID,
};

const CONTEXT = makeTestContext({ sizes: ["XS", "S", "M", "L"] });

type Props = CaptureProps<TensileData, TensileConfig, TensileComputed>;

function evaluationOf(data: TensileData, context: InspectionContext) {
  const template = makeTestTemplate(MODULE_REGISTRY, ["tensile"]);
  const evaluation = evaluateInspection(
    { template, data: { modules: { tensile: data }, custom: {} }, context },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "tensile");
  return (evaluation ?? null) as ModuleEvaluation<TensileComputed> | null;
}

function render(overrides: Partial<Props> = {}): string {
  const data = overrides.data ?? EXAMPLE;
  const context = overrides.context ?? CONTEXT;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={TENSILE_DEFAULT_CONFIG}
      title={TENSILE_TITLE}
      labels={TENSILE_LABELS}
      context={context}
      evaluation={evaluationOf(data, context)}
      focusPath={null}
      readOnly={false}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

const tags = (html: string, pattern: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${pattern}[^>]*>`, "g")), (match) => match[0]);
const statuses = (html: string, slot: string) =>
  tags(html, `data-slot="${slot}"`).map((tag) => /data-status="([a-z_]+)"/.exec(tag)?.[1]);

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

describe("tensile capture", () => {
  it("shows the ordered sizes only, each with calc's result (6.2 rule 4)", () => {
    const html = render();
    expect(tags(html, 'role="tab"').map((tab) => /data-size="([^"]+)"/.exec(tab)?.[1])).toEqual(["XS", "S", "M", "L"]);
    expect(statuses(html, "result-chip")).toEqual(["pass", "pass", "pass", "pass"]);
    // Every size is rendered, side by side from 1280 px; below it one at a time.
    expect(tags(html, 'role="tabpanel"')).toHaveLength(4);
  });

  it("takes both averages of every size on the decimal keypad, in the template's wording", () => {
    const html = render();
    const fields = tags(html, 'data-slot="numeric-cell"');
    expect(fields).toHaveLength(8);
    expect(fields.every((field) => field.includes('inputMode="decimal"'))).toBe(true);
    expect(fields[0]).toContain('value="34.18"');
    expect(fields[1]).toContain('value="536"');
    expect(html).toContain(">Tensile Strength (Average) (MPa)</label>");
    expect(html).toContain(">Elongation at break, average (%)</label>");
    expect(html).toContain(">Spec. (ASTM D6319) ≥ 14.00 MPa</span>");
    expect(html).toContain(">Spec. (ASTM D6319) ≥ 500%</span>");
  });

  it("shows each average's verdict live under its field", () => {
    expect(statuses(render(), "status-pill")).toEqual(Array.from({ length: 8 }, () => "pass"));
    const data: TensileData = { ...EXAMPLE, sizes: { ...EXAMPLE.sizes, S: { tensileStrength: 12.5, elongationAtBreak: null } } };
    expect(statuses(render({ data }), "status-pill")).toEqual(["pass", "pass", "fail", "not_done", "pass", "pass", "pass", "pass"]);
  });

  it("sizes its pills for touch as the kit's own small pills: 16 px on iPad (docs/DESIGN.md)", () => {
    const pills = tags(render({ data: { ...EXAMPLE, labReport: null } }), 'data-slot="status-pill"');
    // Eight verdicts and the lab report's "Not attached".
    expect(pills).toHaveLength(9);
    expect(pills.filter((pill) => !pill.includes("touch:text-base"))).toEqual([]);
  });

  it("says the lab report is required until it is attached", () => {
    const html = render({ data: { ...EXAMPLE, labReport: null } });
    expect(html).toContain(">Lab report</span>");
    expect(html).toContain("Not attached");
    expect(html).toContain("Required before this section is done.");
    const attached = render();
    expect(attached).toContain(">Attached</span>");
    expect(attached).not.toContain("Required before this section is done.");
  });

  it("says where the lab report is attached when the screen gives no file slot (preview, review)", () => {
    const html = render({ data: { ...EXAMPLE, labReport: null } });
    expect(html).toContain('data-slot="module-file-slot"');
    expect(html).toContain("Attach files on the inspection screen.");
  });

  it("puts the screen's file slot for lab reports in the lab report's block", () => {
    const requests: FileSlotRequest[] = [];
    const html = renderToStaticMarkup(
      <FileSlotProvider
        render={(request) => {
          requests.push(request);
          return <span data-test="screen-slot" />;
        }}
      >
        <Capture
          data={EXAMPLE}
          config={TENSILE_DEFAULT_CONFIG}
          title={TENSILE_TITLE}
          labels={TENSILE_LABELS}
          context={CONTEXT}
          evaluation={evaluationOf(EXAMPLE, CONTEXT)}
          focusPath={null}
          readOnly
          focus={{ size: "M" }}
          onChange={() => {}}
        />
      </FileSlotProvider>,
    );
    const block = html.slice(html.indexOf('data-slot="lab-report"'), html.indexOf("</section>"));
    expect(block).toContain('<span data-test="screen-slot"></span>');
    // It opens on the size chosen in the last module, and tags new files with it.
    expect(requests).toEqual([
      expect.objectContaining({ moduleKey: "tensile", kind: "lab_report", focus: { size: "M" }, readOnly: true }),
    ]);
  });

  it("says when the lab report kept here was deleted since", () => {
    const context = makeTestContext({ ...CONTEXT, files: [] });
    const html = render({ context });
    expect(html).toContain('data-state="missing"');
    expect(html).toContain("Lab report: the file attached here is no longer with this inspection. Attach it again.");
  });

  it("shows calc's error under the field it concerns", () => {
    const data: TensileData = { ...EXAMPLE, sizes: { ...EXAMPLE.sizes, M: { tensileStrength: 0, elongationAtBreak: 555 } } };
    expect(render({ data })).toContain("Size M: Tensile Strength (Average) (MPa) must be more than 0, not 0.");
  });

  it("keeps the fields read-only for an inspection that cannot be edited", () => {
    const fields = tags(render({ readOnly: true }), 'data-slot="numeric-cell"');
    expect(fields).toHaveLength(8);
    expect(fields.every((field) => field.includes("readOnly"))).toBe(true);
  });

  it("marks each field and the lab report for issue links", () => {
    const html = render();
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;S&quot;,&quot;elongationAtBreak&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;labReport&quot;]"');
  });

  it("keeps its screen-reader text inside a positioned box (docs/DESIGN.md, D1)", () => {
    expect(unanchoredSrOnly(render())).toEqual([]);
    expect(unanchoredSrOnly(render({ readOnly: true, data: { ...EXAMPLE, labReport: null } }))).toEqual([]);
  });

  it("says no sizes are ordered yet instead of showing fields", () => {
    const html = render({ context: makeTestContext({ sizes: [] }), data: { sizes: {}, labReport: null } });
    expect(html).toContain("No sizes ordered yet.");
    expect(html).not.toContain("<input");
  });
});
