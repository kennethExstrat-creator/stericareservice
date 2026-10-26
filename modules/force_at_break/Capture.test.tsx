// Server-rendered markup of the capture body: the template's wording, only
// the ordered sizes, the grid with its computed footer, read-only text, the
// lab report's line with the screen's file slot (what Steri-AI linked or
// found) and the notices. Key, paste and focus handling are the kit's
// (components/qc), tested there; the edits are pure (edit.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluateInspection, type CaptureProps, type InspectionContext, type ModuleEvaluation } from "@/modules/_framework";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
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
  const data = overrides.data ?? { sizes: { M: { values: READINGS } }, labReports: [] };
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

/** The captions of the grid's footer rows, as a screen reader reads them. */
const rowHeaders = (html: string): string[] =>
  Array.from(html.matchAll(/<[^>]*role="rowheader"[^>]*>([^<]*)</g), (match) => match[1].replaceAll("&amp;", "&"));

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
    // The readings in groups side by side, the footer named as the grid is.
    expect(html).toContain(`role="group" aria-label="${FORCE_AT_BREAK_TITLE}, size M"`);
    expect(html).toContain(`role="table" aria-label="${FORCE_AT_BREAK_TITLE}, size M"`);
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(13);
    expect(cells[0]).toContain('aria-label="Force at Break (N), No. 1"');
    expect(cells[0]).toContain('inputMode="decimal"');
    expect(cells[0]).toContain('value="6.470"');
    for (const label of ["Median", "Spec.", "Passed / Failed"]) expect(rowHeaders(html)).toContain(label);
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
    expect(rowHeaders(html)).toEqual(expect.arrayContaining(["Median value", "Spec. (EN 455)"]));
    expect(html).toContain(">Test report</span>");
  });

  it("says whether the lab report is attached: calc's state on the line, the screen's slot in it", () => {
    const line = (html: string) => /<div[^>]*data-slot="attachment-status"[^>]*>/.exec(html)?.[0] ?? "";
    expect(line(render())).toContain('data-state="none"');
    const attached = render({ data: { sizes: { M: { values: READINGS } }, labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }] } });
    expect(attached).toContain('data-attached="true"');
    // Optional: the readings decide the result whether a lab report is linked or not.
    const unlinked = evaluationOf({ sizes: { M: { values: READINGS } }, labReports: [] }, CONTEXT, FORCE_AT_BREAK_DEFAULT_CONFIG);
    expect(unlinked?.result.perSize?.M?.status).toBe("pass");
    const gone = render({
      data: { sizes: { M: { values: READINGS } }, labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }] },
      context: makeTestContext({ ...CONTEXT, files: [] }),
    });
    expect(gone).toContain('data-state="missing"');
    expect(gone).toContain("Lab Report: the file linked here is not among this inspection&#x27;s files. It may still be uploading from another device; if it was deleted, upload it again on Source Documents.");
    // The issue link lands on the kit's attachment line, which takes the focus itself.
    expect(line(gone)).toContain('tabindex="-1"');
    expect(line(gone)).toContain('data-issue-path="[&quot;labReport&quot;]"');
  });

  it("says where the lab report is attached when the screen gives no file slot (preview, review)", () => {
    expect(render()).toContain("Attach files on the inspection screen.");
  });

  it("puts the screen's file slot for lab reports in the lab report's line, with the kept file and calc's state", () => {
    const requests: FileSlotRequest[] = [];
    const data: ForceAtBreakData = { sizes: { M: { values: READINGS } }, labReports: [] };
    const html = renderToStaticMarkup(
      <FileSlotProvider
        render={(request) => {
          requests.push(request);
          return <span data-test="screen-slot" />;
        }}
      >
        <Capture
          data={data}
          config={FORCE_AT_BREAK_DEFAULT_CONFIG}
          title={FORCE_AT_BREAK_TITLE}
          labels={FORCE_AT_BREAK_LABELS}
          context={CONTEXT}
          evaluation={evaluationOf(data, CONTEXT, FORCE_AT_BREAK_DEFAULT_CONFIG)}
          focusPath={null}
          readOnly={false}
          focus={{ size: "L" }}
          onChange={() => {}}
        />
      </FileSlotProvider>,
    );
    const block = html.slice(html.indexOf('data-slot="lab-report"'), html.indexOf("</section>"));
    expect(block).toMatch(/data-slot="attachment-file"[^>]*><div data-slot="module-file-slot"[^>]*><span data-test="screen-slot"><\/span>/);
    // No picker and no words of its own beside the slot.
    expect(block).not.toContain("Not Attached");
    expect(requests).toEqual([
      expect.objectContaining({
        moduleKey: "force_at_break",
        kind: "lab_report",
        fileId: null,
        state: "none",
        countsModuleFiles: true,
        readOnly: false,
      }),
    ]);
  });

  describe("several lab reports (Kenneth, 26 October 2026: one per size)", () => {
    const REPORTS = {
      S: "00000000-0000-4000-8000-000000000411",
      M: "00000000-0000-4000-8000-000000000412",
      L: "00000000-0000-4000-8000-000000000413",
      XL: "00000000-0000-4000-8000-000000000414",
    };
    const files = (ids: readonly string[]) => ids.map((id) => ({ id, moduleKey: "source_documents", kind: "lab_report" as const }));

    /** The body inside a screen's file slot: its markup and the slot's requests. */
    function inSlot(data: ForceAtBreakData, context: InspectionContext = CONTEXT) {
      const requests: FileSlotRequest[] = [];
      const html = renderToStaticMarkup(
        <FileSlotProvider
          render={(request) => {
            requests.push(request);
            return <span data-test="screen-slot">{request.fileId}</span>;
          }}
        >
          <Capture
            data={data}
            config={FORCE_AT_BREAK_DEFAULT_CONFIG}
            title={FORCE_AT_BREAK_TITLE}
            labels={FORCE_AT_BREAK_LABELS}
            context={context}
            evaluation={evaluationOf(data, context, FORCE_AT_BREAK_DEFAULT_CONFIG)}
            focusPath={null}
            readOnly={false}
            onChange={() => {}}
          />
        </FileSlotProvider>,
      );
      return { html, requests };
    }

    it("lists every report in size order, each by its sizes with a slot of its own, under 'Lab Reports'", () => {
      // Linked as the readings finished: in no particular order.
      const data: ForceAtBreakData = {
        sizes: { M: { values: READINGS } },
        labReports: [
          { fileId: REPORTS.L, sizes: ["L"] },
          { fileId: REPORTS.S, sizes: ["S"] },
          { fileId: REPORTS.XL, sizes: ["XL"] },
          { fileId: REPORTS.M, sizes: ["M"] },
        ],
      };
      const context = makeTestContext({ ...CONTEXT, files: files(Object.values(REPORTS)) });
      const { html, requests } = inSlot(data, context);
      expect(requests.map((request) => [request.caption, request.fileId])).toEqual([
        ["Size S", REPORTS.S],
        ["Size M", REPORTS.M],
        ["Size L", REPORTS.L],
        ["Size XL", REPORTS.XL],
      ]);
      // Each its own file: attached, unlinked on its own, and never a step's file counted in its place.
      for (const request of requests) expect(request).toMatchObject({ state: "attached", countsModuleFiles: false, readOnly: false });
      expect(html).toContain('<section data-slot="lab-report" aria-label="Lab Reports"');
      expect(html).toContain(">Lab Reports</span>");
      expect(html.match(/data-slot="lab-report-entry"/g)).toHaveLength(4);
      expect(html).toContain('data-attached="true"');
      expect(html).not.toContain("No lab report detected");
    });

    it("names a report whose sizes are not known by its file alone, last, and keeps 'Lab Report' for one", () => {
      const legacy: ForceAtBreakData = { sizes: {}, labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }] };
      const one = inSlot(legacy);
      expect(one.requests).toEqual([expect.objectContaining({ fileId: LAB_REPORT_ID, countsModuleFiles: false })]);
      expect(one.requests[0]).not.toHaveProperty("caption");
      expect(one.html).toContain(">Lab Report</span>");
      const both = inSlot({ sizes: {}, labReports: [...legacy.labReports, { fileId: REPORTS.M, sizes: ["M"] }] });
      expect(both.requests.map((request) => request.fileId)).toEqual([REPORTS.M, LAB_REPORT_ID]);
      expect(both.html).toContain(">Lab Reports</span>");
    });

    it("warns for each kept report that is gone, by its sizes, and keeps the others attached", () => {
      const data: ForceAtBreakData = {
        sizes: {},
        labReports: [
          { fileId: REPORTS.S, sizes: ["S"] },
          { fileId: REPORTS.XL, sizes: ["XL"] },
        ],
      };
      const { html, requests } = inSlot(data, makeTestContext({ ...CONTEXT, files: files([REPORTS.S]) }));
      expect(requests.map((request) => [request.fileId, request.state])).toEqual([
        [REPORTS.S, "attached"],
        [REPORTS.XL, "missing"],
      ]);
      expect(html).toContain('data-state="attached"');
      expect(html).toContain("Lab Report for Size XL: the file linked here is not among this inspection&#x27;s files.");
      expect(html).not.toContain("Lab Report for Size S:");
    });
  });

  it("keeps the readings focusable on grey when read-only, with calc's footer", () => {
    const html = render({ readOnly: true });
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells).toHaveLength(13);
    // Read-only inputs: Tab, the arrows and issue links still reach them; nothing can change.
    for (const cell of cells) expect(cell).toContain('readOnly=""');
    expect(cells[0]).toContain('value="6.470"');
    expect(html).toContain('data-readonly="true"');
    expect(html).toContain(">6.537<");
    const pills = tags(html, 'data-slot="status-pill"');
    expect(pills.map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1])).toEqual(["pass"]);
    // 16 px on iPad, as the kit's own small pills (docs/DESIGN.md).
    expect(pills[0]).toContain("touch:text-base");
  });

  it("takes the footer's median and verdict from calc: a size calc says is not done shows neither", () => {
    // 13 readings, one of them 0 N (saved another way): calc counts 12 and the size is not done.
    const data = { sizes: { M: { values: [...READINGS.slice(0, 12), 0] } }, labReports: [] };
    const html = render({ data });
    const pills = tags(html, 'data-slot="status-pill"').map((pill) => /data-status="([a-z_]+)"/.exec(pill)?.[1]);
    // The median cell and the verdict cell both read Not Done.
    expect(pills).toEqual(["not_done", "not_done"]);
    expect(html).not.toContain(">Passed<");
  });

  it("lists readings past the gloves tested, with calc's message and a way to clear them", () => {
    const data = { sizes: { M: { values: [...READINGS, null, 6.1, 6.3] } }, labReports: [] };
    const html = render({ data });
    expect(html).toContain("Size M: 2 readings are entered beyond the 13 gloves tested. Clear them or correct the sampling plan.");
    expect(html).toContain("No. 15: 6.1 N, No. 16: 6.3 N");
    expect(html).toMatch(/<button[^>]*touch:text-base[^>]*>Clear the 2 Extra Readings<\/button>/);
    expect(render({ data, readOnly: true })).not.toContain("Clear the 2 Extra Readings");
  });

  it("sends the issue link to the notice's message, never to the button that clears readings", () => {
    const data = { sizes: { M: { values: [...READINGS, 6.1] } }, labReports: [] };
    const html = render({ data });
    // The message takes the focus itself (tabIndex -1); the box with the button carries no path.
    const [notice, ...others] = tags(html, 'data-slot="size-notice"');
    expect(others).toEqual([]);
    expect(notice).toMatch(/^<p /);
    expect(notice).toContain('tabindex="-1"');
    const path = 'data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;values&quot;]"';
    expect(notice).toContain(path);
    expect(tags(html, "data-issue-path").filter((tag) => tag.includes(path))).toEqual([notice]);
    // Each reading's cell has a path of its own: an issue on reading 3 lands there.
    const cells = tags(html, 'data-slot="numeric-cell"');
    expect(cells[2]).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;values&quot;,2]"');
  });

  it("says when the sampling plan asks for more readings than a size can take", () => {
    const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 600 }) } });
    const html = render({ context });
    expect(tags(html, 'data-slot="numeric-cell"')).toHaveLength(500);
    const [notice] = tags(html, 'data-slot="size-notice"');
    expect(notice).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;]"');
    expect(html).toContain(
      "Size M: the sampling plan gives 600 gloves to test; at most 500 readings can be entered. Correct the sampling plan.",
    );
  });

  it("explains a size the sampling plan gives no gloves to test", () => {
    const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 0 }) } });
    const html = render({ context, data: { sizes: {}, labReports: [] } });
    expect(html).toContain("No gloves to test in the sampling plan for size M.");
    expect(html).not.toContain("<input");
  });

  it("still shows readings saved for a size the plan now gives no gloves, with calc's error and a way to clear them", () => {
    const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 0 }) } });
    const html = render({ context, data: { sizes: { M: { values: [6.5, 6.6] } }, labReports: [] } });
    expect(html).toContain("No gloves to test in the sampling plan for size M.");
    expect(html).toContain(
      "Size M: 2 readings are entered, but the sampling plan gives no gloves to test. Clear them or correct the sampling plan.",
    );
    expect(html).toContain(">Clear the 2 Extra Readings</button>");
    // The issue link lands on the notice.
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;values&quot;]"');
  });

  it("says no sizes are ordered yet instead of showing a grid", () => {
    const html = render({ context: makeTestContext({ sizes: [] }), data: { sizes: {}, labReports: [] } });
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

  it("flows the readings across the module's width in groups, as weight's grid does, the notes under them", () => {
    const data = { sizes: { M: { values: [...READINGS, 6.1, 6.3] } }, labReports: [] };
    const html = render({ data });
    // One column of 13 readings: 1 to 5, 6 to 10 and 11 to 13 side by side, in order.
    expect(tags(html, 'data-slot="measurement-grid"')[0]).toContain('data-flow=""');
    expect(Array.from(html.matchAll(/<table aria-label="([^"]*)"/g), (match) => match[1])).toEqual([
      "No. 1 to 5",
      "No. 6 to 10",
      "No. 11 to 13",
    ]);
    // The notes go under the readings at every width: the panel is one column.
    const [panel] = tags(html, "data-panel-size");
    const classes = /class="([^"]*)"/.exec(panel)?.[1].split(" ") ?? [];
    expect(classes.filter((name) => name.includes("grid-cols-"))).toEqual([]);
    expect(html.indexOf("13 gloves tested, from the sampling plan.")).toBeGreaterThan(html.indexOf('role="table"'));
    // The button that clears readings wraps rather than runs out of a narrow column.
    expect(html).toMatch(/<button[^>]*whitespace-normal[^>]*>Clear the 2 Extra Readings<\/button>/);
  });
});
