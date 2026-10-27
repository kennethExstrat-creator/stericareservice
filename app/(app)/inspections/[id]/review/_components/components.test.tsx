// The review's parts as server-rendered markup, with the framework's test
// registry behind the results: every state the live database cannot show
// while the modules are stubs (passes, fails, warnings, per-size results).
// Layout A (Kenneth, 27 October 2026): cards with their headings inside,
// labels and values, module rows that open.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stdEgInspectionData, stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import { richTextExample } from "@/lib/rich-text/__fixtures__/example";
import {
  evaluated,
  INSPECTION_ID,
  reviewInspection,
  savedData,
  storedInspection,
} from "@/lib/inspections/review/__fixtures__/review";
import type { AttentionItem } from "@/lib/inspections/review/attention";
import type { AuditEntry } from "@/lib/inspections/review/audit";
import { evaluateStoredInspection } from "@/lib/inspections/review/evaluate";
import type { ReviewPhoto } from "@/lib/inspections/review/photos";
import type { ReportOptions } from "@/lib/schemas/report-options";
import { MODULE_REGISTRY } from "@/modules/registry";
import { Attention, sizesText } from "./attention";
import { ClientReport, reportLine } from "./client-report";
import { History } from "./history";
import { InspectionFacts } from "./inspection-facts";
import { InspectionSummary } from "./inspection-summary";
import { formatCustomValue, ModuleResults, moduleRowsOf } from "./module-results";
import { ReportPhotos } from "./report-photos";
import { StatusNotice } from "./status-notice";
import { SwitchedOffModules } from "./switched-off-modules";
import { Verdict } from "./verdict";

/** Text content without tags, for reading order. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * The text as textContent has it, which is what a screen reader reads and a
 * copy takes: tags dropped without adding spaces, so words in neighbouring
 * elements run together unless the markup spaces them.
 */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** The markup of one module row; rows hold lists of their own, so <li> depth is counted. */
function row(html: string, id: string): string {
  const start = html.indexOf(`<li id="${id}"`);
  expect(start, `${id} is listed`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const pattern = /<li[\s>]|<\/li>/g;
  pattern.lastIndex = start;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0] === "</li>" ? -1 : 1;
    if (depth === 0) return html.slice(start, match.index + 5);
  }
  return html.slice(start);
}

/** A module row's body as the server renders it, open or not. */
function body(evaluation: ReturnType<typeof evaluated>, key: string): string {
  if (!evaluation.ok) throw new Error("the review fixture does not evaluate");
  const found = moduleRowsOf(evaluation).rows.find((entry) => entry.key === key);
  expect(found, `${key} has a row`).toBeDefined();
  return renderToStaticMarkup(<>{found?.body}</>);
}

describe("ModuleResults", () => {
  const evaluation = evaluated();
  const html = renderToStaticMarkup(<ModuleResults evaluation={evaluation} />);

  it("titles the section and lists every included module and custom section in the template's order", () => {
    expect(text(html).startsWith("Module Results ")).toBe(true);
    const keys = [...html.matchAll(/<li id="(module|custom)-([a-z_]+)"/g)].map((match) => match[2]);
    expect(keys).toEqual([
      "header",
      "glove_type",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "weight",
      "visual",
      "conclusion",
    ]);
  });

  it("is a line per module: its title, its result per size, its problems and its result", () => {
    const visual = row(html, "module-visual");
    expect(visual).toContain('data-status="fail"');
    // lib/format's size names: the template labels M "Medium" and L "L".
    expect(plain(visual)).toMatch(/Visual Inspection \(AQL\)Medium: PassedL: Failed/);
    expect(visual).toMatch(/<span data-slot="status-pill" data-status="fail"/);
  });

  it("opens the modules with an error, a warning or a fail, and leaves the rest as a line", () => {
    for (const id of ["module-visual", "module-carton_sampling", "module-weight"]) {
      expect(row(html, id)).toContain('aria-expanded="true"');
    }
    expect(row(html, "module-header")).toContain('aria-expanded="false"');
    expect(row(html, "module-header")).not.toContain("module-header-body");
  });

  it("narrows the list to results, information or issues", () => {
    const filters = /<div role="group" aria-label="Show"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(plain(filters)).toMatch(/^All10With Results\d+Information\d+Issues\d+$/);
    expect(filters).toContain('aria-pressed="true"');
    expect(text(html)).toContain("Expand All");
  });

  it("sizes every result pill like the capture kit's: 16 px text on the iPad", () => {
    const pills = [...row(html, "module-visual").matchAll(/<span data-slot="status-pill"[^>]*class="([^"]*)"/g)];
    expect(pills.length).toBeGreaterThan(0);
    for (const [, classes] of pills) expect(classes).toContain("touch:text-base");
  });

  it("shows the inspector's comment when there is one, and nothing when there is none", () => {
    expect(text(body(evaluation, "visual"))).toContain("One embedded insect in size L.");
    expect(text(body(evaluation, "header"))).not.toMatch(/comment/i);
  });

  it("lists errors and warnings under their module, one short line each, in words as well as colour", () => {
    const cartons = body(evaluation, "carton_sampling");
    expect(cartons).toContain('data-level="error"');
    expect(plain(cartons)).toContain("Error: Carton 2 is entered twice for size M");
    expect(plain(body(evaluation, "weight"))).toContain("Warning: Average 2.8 g is 20% below the indicative 3.5 g");
  });

  it("does not repeat 'not done' as a warning under a module that says Not Done", () => {
    const notDone = evaluated({ data: { ...savedData(), modules: { ...savedData().modules, packing_config: {} } } });
    const packing = row(renderToStaticMarkup(<ModuleResults evaluation={notDone} />), "module-packing_config");
    expect(packing).toContain('data-status="not_done"');
    expect(body(notDone, "packing_config")).not.toContain('data-issue="module_not_done"');
  });

  it("shows a custom section's values with units", () => {
    expect(text(row(html, "custom-glove_type"))).toContain("Extra Fields");
    expect(text(body(evaluation, "glove_type"))).toMatch(/Glove type Powder-free Sterile No Length 240 mm/);
  });

  it("leaves clearing the bars to the page's scroll padding: no scroll margin of its own", () => {
    const section = /<section id="modules"[^>]*>/.exec(html)?.[0] ?? "";
    const visual = /<li id="module-visual"[^>]*>/.exec(html)?.[0] ?? "";
    expect(section).toContain('aria-labelledby="modules-heading"');
    for (const tag of [section, visual]) expect(tag).not.toContain("scroll-mt");
  });

  it("explains instead of listing when the results cannot be worked out", () => {
    const broken = renderToStaticMarkup(<ModuleResults evaluation={evaluated({ resolved: null })} />);
    expect(text(broken)).toContain("could not be read, so its results cannot be worked out");
    expect(broken).not.toContain("<ol");
  });

  it("shows the inspector's HOLD as on hold, as the final result reads, not as a warning", () => {
    const held = renderToStaticMarkup(
      <ModuleResults
        evaluation={evaluated({
          data: { ...savedData(), modules: { ...savedData().modules, conclusion: { finalResult: "hold", remark: null } } },
        })}
      />,
    );
    const conclusion = row(held, "module-conclusion");
    expect(conclusion).toContain('data-status="hold"');
    expect(conclusion).toContain('data-slot="status-pill" data-status="hold"');
    expect(text(conclusion)).toContain("On Hold");
    expect(text(conclusion)).not.toContain("Warning");
  });
});

describe("ModuleResults on the STD_EG example", () => {
  // The real modules: a table per module, the sizes side by side.
  const evaluation = evaluateStoredInspection(storedInspection({ resolved: stdEgTemplate(), data: stdEgInspectionData() }), MODULE_REGISTRY);

  it("gives a module with per-size figures a table, its sizes as columns and a Result row", () => {
    const watertight = body(evaluation, "watertight");
    expect(watertight).toContain("<table");
    expect(text(watertight)).toContain("M");
    expect(text(watertight)).toMatch(/Result Passed/);
  });

  it("shows a module without per-size figures as its summary", () => {
    expect(text(body(evaluation, "header"))).not.toBe("");
    expect(body(evaluation, "header")).not.toContain("<table");
  });
});

describe("formatCustomValue", () => {
  it.each([
    [{ type: "number" as const, unit: "mm" as const }, 240.5, "240.5 mm"],
    [{ type: "number" as const, unit: "%" as const }, 88, "88%"],
    [{ type: "counter" as const }, 1250, "1,250"],
    [{ type: "yes_no" as const }, true, "Yes"],
    [{ type: "date" as const }, "2026-10-05", "5 Oct 2026"],
    [{ type: "text" as const }, "Blue", "Blue"],
    [{ type: "photo" as const }, ["a", "b"], "2 photos"],
    [{ type: "number" as const }, [1, null, 3], "1, —, 3"],
    // lib/format: every digit as entered, grouped, without binary noise.
    [{ type: "number" as const, unit: "mm" as const }, 1234.5, "1,234.5 mm"],
    [{ type: "number" as const }, 0.1 + 0.2, "0.3"],
    [{ type: "number" as const, unit: "g" as const }, 0.0125, "0.0125 g"],
  ])("%j shows %j as %j", (field, value, shown) => {
    expect(formatCustomValue(field, value)).toBe(shown);
  });

  it.each([[null], [undefined], ["  "], [[]], [Number.NaN], [{ odd: true }]])("shows %j as nothing entered", (value) => {
    expect(formatCustomValue({ type: "text" }, value)).toBeNull();
  });
});

describe("Verdict", () => {
  it("sets the inspector's final result and remark beside the app's suggestion and the checks", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated()} />));
    expect(html).toContain("Final Result (Inspector) Failed Remark: Critical defect in size L.");
    expect(html).toContain(
      "Suggested by the App Failed Matches Failed: Finished Goods Sampling Information (carton number), Visual Inspection (AQL).",
    );
    expect(html).toContain("Checks 1 error 1 warning Every module is done");
    expect(html).not.toContain("Differs");
  });

  it("says what failed or is not done under the suggestion, and leaves the warnings to the checks", () => {
    const html = renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated()} />);
    const reasons = html.match(/<ul data-slot="suggested-reasons"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
    expect([...reasons.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1])).toEqual([
      "Failed: Finished Goods Sampling Information (carton number), Visual Inspection (AQL).",
    ]);
    // The problems link to the list of them.
    expect(html).toMatch(/<a href="#attention"[^>]*>.*1 error/);
  });

  it("says nothing more for a clean pass", () => {
    const evaluation = evaluated();
    if (!evaluation.ok) throw new Error("the review fixture does not evaluate");
    const clean = {
      ...evaluation,
      report: { ...evaluation.report, suggested: { result: "pass" as const, failed: [], notDone: [], warned: [], summary: "Pass." } },
    };
    const passed = renderToStaticMarkup(<Verdict inspection={reviewInspection({ result: "pass", savedSuggestion: "pass" })} evaluation={clean} />);
    expect(passed).not.toContain('data-slot="suggested-reasons"');
    expect(text(passed)).toContain("Final Result (Inspector) Passed");
    expect(text(passed)).toContain("Suggested by the App Passed Matches");
  });

  it("points out a final result that differs, and a suggestion that changed since it was saved", () => {
    const html = text(
      renderToStaticMarkup(<Verdict inspection={reviewInspection({ result: "pass", savedSuggestion: "pass" })} evaluation={evaluated()} />),
    );
    expect(html).toContain("Differs from the final result");
    expect(html).toContain("Was passed when last saved");
  });

  it("says when no final result is chosen yet", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection({ result: null, remarks: null })} evaluation={evaluated()} />));
    expect(html).toContain("Final Result (Inspector) Not Chosen Remark: —");
  });

  it("says when the results cannot be worked out", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated({ data: null })} />));
    expect(html).toContain("Suggested by the App Not available");
    expect(html).toContain("saved data could not be read");
  });
});

describe("InspectionSummary", () => {
  /** The STD_EG example on the real modules, the conclusion's summary as given. */
  function withSummary(inspectionSummary: unknown) {
    const data = stdEgInspectionData();
    const modules = { ...data.modules, conclusion: { ...(data.modules.conclusion as Record<string, unknown>), inspectionSummary } };
    return evaluateStoredInspection(storedInspection({ resolved: stdEgTemplate(), data: { ...data, modules } }), MODULE_REGISTRY);
  }

  it("shows the summary's first paragraph with its formatting, and Show More for the rest, without an editor", () => {
    const html = renderToStaticMarkup(<InspectionSummary evaluation={withSummary(richTextExample())} />);
    expect(text(html)).toMatch(/^Inspection Summary Shipment released/);
    expect(html).toContain('<p class="text-center"><strong>Shipment </strong><span class="text-[1.25em] text-[#166534]">');
    expect(text(html)).not.toContain("Two cartons re-taped");
    expect(text(html)).toContain("Show More");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("style=");
  });

  it("says None when there is no summary, and is left out with no conclusion to hold one", () => {
    expect(text(renderToStaticMarkup(<InspectionSummary evaluation={withSummary(null)} />))).toBe("Inspection Summary None");
    expect(renderToStaticMarkup(<InspectionSummary evaluation={evaluated({ data: null })} />)).toBe("");
  });
});

describe("Attention", () => {
  const item: AttentionItem = {
    key: "visual|warning|defect_unmapped|x",
    level: "warning",
    moduleKey: "visual",
    code: "defect_unmapped",
    text: `Major Defects: "Ring mark" is not in the template's defect list`,
    sizes: [
      { size: "M", count: 2 },
      { size: "L", count: 2 },
      { size: "XL", count: 1 },
    ],
  };
  const render = (items: AttentionItem[], canMapLabels = true) =>
    renderToStaticMarkup(
      <Attention
        items={items}
        titleOf={() => "Visual Inspection"}
        anchorOf={(key) => `module-${key}`}
        sizeLabel={(size) => size}
        canMapLabels={canMapLabels}
      />,
    );

  it("says each problem on one line with its module and sizes, and links to the module", () => {
    const html = render([item]);
    expect(plain(html)).toContain(`Warning: Visual Inspection Major Defects: "Ring mark" is not in the template's defect list M 2, L 2, XL 1`);
    expect(html).toMatch(/<a[^>]*href="#module-visual"[^>]*>Show<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/admin\/defects\/unmapped"[^>]*>Map Label<\/a>/);
  });

  it("offers Map Label only to those who look after the defect codes, and is left out with nothing to say", () => {
    expect(render([item], false)).not.toContain("Map Label");
    expect(render([])).toBe("");
  });

  it("writes sizes without counts when the sentences named none", () => {
    expect(sizesText({ sizes: [{ size: "M", count: null }, { size: "L", count: null }] }, (size) => size)).toBe("M, L");
  });
});

describe("ClientReport", () => {
  const options = { template: "standard_preshipment", pageSize: "letter" } as ReportOptions;

  it("names the report and its paper, and opens the PDF and the Report page", () => {
    expect(reportLine(options)).toBe("Standard Preshipment Report · Letter");
    const html = renderToStaticMarkup(<ClientReport inspectionId={INSPECTION_ID} options={options} />);
    expect(text(html)).toContain("Client Report Standard Preshipment Report · Letter");
    expect(html).toContain(`href="/inspections/${INSPECTION_ID}/report/print?print=1" target="_blank"`);
    expect(html).toContain(`href="/inspections/${INSPECTION_ID}?module=report"`);
  });
});

describe("StatusNotice", () => {
  it("gives a reopen's reason its own labelled box", () => {
    const html = renderToStaticMarkup(
      <StatusNotice
        notice={{ status: "reopened", title: "Reopened: Changes Needed", body: "An admin reopened it.", reason: { label: "What to Change", text: "Retest size M." } }}
      />,
    );
    expect(html).toContain('<h2 id="review-status"');
    expect(html).toContain('data-status="reopened"');
    expect(text(html)).toContain("What to Change Retest size M.");
  });
});

describe("InspectionFacts", () => {
  it("lists the facts, who approved it as the viewer may know them, and the template version", () => {
    const html = renderToStaticMarkup(
      <InspectionFacts
        inspection={reviewInspection({ status: "approved", approvedAt: "2026-10-06T07:00:00+00:00", approver: { kind: "admin" } })}
        template={{ id: "t", code: "TEST_EG", version: 3, name: "Test examination gloves" }}
      />,
    );
    expect(text(html)).toMatch(/^Inspection Details /);
    expect(text(html)).toContain("Manufacturer Manufacturer A · Plant 1");
    expect(text(html)).toContain("Lot Numbers LOT-M-0001, LOT-L-0001");
    expect(text(html)).toContain("Inspection Date 5 Oct 2026");
    expect(text(html)).toContain("Template TEST_EG Version 3");
    expect(html).toContain('title="Test examination gloves"');
    expect(text(html)).toContain("Approved By An admin");
  });

  it("says what is missing instead of leaving gaps", () => {
    const html = text(
      renderToStaticMarkup(<InspectionFacts inspection={reviewInspection({ client: null, poNo: null, lotNumbers: [] })} template={null} />),
    );
    expect(html).toContain("Client — No Client");
    expect(html).toContain("PO — No PO yet");
    expect(html).toContain("Template — Template not readable");
  });
});

describe("SwitchedOffModules", () => {
  it("lists each module switched off for this inspection with its reason, on one line", () => {
    const html = text(
      renderToStaticMarkup(
        <SwitchedOffModules
          overrides={[{ key: "weight", title: "Weight (g)", reason: "Scale broken.", by: { kind: "admin" }, at: "2026-10-05T03:00:00Z" }]}
        />,
      ),
    );
    expect(html).toBe("Switched Off for This Inspection 1 Weight (g) · Reason: Scale broken. · an admin · 5 Oct 2026, 11:00");
  });

  it("is left out when nothing is switched off", () => {
    expect(renderToStaticMarkup(<SwitchedOffModules overrides={[]} />)).toBe("");
  });
});

describe("ReportPhotos", () => {
  const photo: ReviewPhoto = {
    id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
    thumbUrl: "https://storage.example.com/thumb.jpg",
    fullUrl: "https://storage.example.com/full.jpg",
    alt: "Insect in the cuff (Visual Inspection, size L)",
    tags: { module: "Visual Inspection", size: "L" },
    caption: "Insect in the cuff",
    flagged: false,
    takenAt: null,
  };

  it("shows each report photo, opening full size in a new tab, and links to all of them", () => {
    const html = renderToStaticMarkup(<ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [photo], total: 4, failed: false }} canChoose />);
    expect(text(html)).toMatch(/^Report Photos 1 of 4 /);
    // Named by what the tile shows, its caption and tag line, first.
    expect(html).toContain(
      '<a href="https://storage.example.com/full.jpg" target="_blank" rel="noopener noreferrer" aria-label="Insect in the cuff, Visual Inspection · Size L (opens full size in a new tab)"',
    );
    expect(html).toContain('src="https://storage.example.com/thumb.jpg"');
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${INSPECTION_ID}/photos"[^>]*>.*All Photos \\(4\\)`));
  });

  it.each([
    [0, true, "No photos taken"],
    [3, true, "None marked yet"],
    [3, false, "None marked yet; an admin chooses them"],
  ])("with %i photos (chooses: %s) says %j beside the title", (total, canChoose, words) => {
    const html = text(renderToStaticMarkup(<ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [], total, failed: false }} canChoose={canChoose} />));
    expect(html).toMatch(new RegExp(`^Report Photos ${words} All Photos`));
  });

  it("says when photos could not be loaded, without claiming there are none", () => {
    const html = text(renderToStaticMarkup(<ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [], total: null, failed: true }} canChoose />));
    expect(html).toContain("Some photos could not be loaded.");
    expect(html).not.toContain("None marked");
  });
});

describe("History", () => {
  const entries: AuditEntry[] = [
    { id: 1, at: "2026-10-05T01:00:00Z", kind: "created", title: "Created", actor: { kind: "system" }, actorId: null, reason: null, detail: null },
    {
      id: 2,
      at: "2026-10-06T02:00:00Z",
      kind: "reopened",
      title: "Reopened",
      actor: { kind: "admin" },
      actorId: "00000000-0000-4000-8000-000000000102",
      reason: "Retest size M.",
      detail: null,
    },
  ];

  it("lists who did what and when, one line each, oldest first, with the reason for a reopen", () => {
    const html = text(renderToStaticMarkup(<History history={{ entries, failed: false }} />));
    expect(html).toContain("History 2");
    expect(html).toContain("Created · the system · 5 Oct 2026, 09:00");
    expect(html).toContain("Reopened · an admin · 6 Oct 2026, 10:00 · Reason: Retest size M.");
  });

  it("keeps what happened apart from who did it when read out", () => {
    const html = plain(renderToStaticMarkup(<History history={{ entries, failed: false }} />));
    expect(html).toContain("Created · the system · 5 Oct 2026, 09:00");
  });

  it("folds a run of the same event into one line with its count", () => {
    const reads: AuditEntry[] = Array.from({ length: 16 }, (_, index) => ({
      id: 10 + index,
      at: `2026-10-05T03:${String(27 + Math.floor(index / 3)).padStart(2, "0")}:00Z`,
      kind: "event",
      title: "Source Document Read",
      actor: { kind: "system" },
      actorId: null,
      reason: null,
      detail: null,
    }));
    const html = renderToStaticMarkup(<History history={{ entries: [entries[0], ...reads], failed: false }} />);
    expect(html.match(/<li[\s>]/g)?.length).toBe(2 + 16);
    expect(text(html)).toContain("Source Document Read × 16 · the system · 5 Oct 2026, 11:27 to 11:32");
    expect(html).toContain("<details");
  });

  it("says when the history could not be loaded", () => {
    expect(text(renderToStaticMarkup(<History history={{ entries: [], failed: true }} />))).toContain("The history could not be loaded.");
  });
});
