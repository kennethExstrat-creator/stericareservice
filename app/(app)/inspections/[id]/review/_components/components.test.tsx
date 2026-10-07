// The review's parts as server-rendered markup, with the framework's test
// registry behind the results: every state the live database cannot show
// while the modules are stubs (passes, fails, warnings, per-size results).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stdEgInspectionData, stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import {
  evaluated,
  INSPECTION_ID,
  reviewInspection,
  savedData,
  storedInspection,
} from "@/lib/inspections/review/__fixtures__/review";
import type { AuditEntry } from "@/lib/inspections/review/audit";
import { evaluateStoredInspection } from "@/lib/inspections/review/evaluate";
import type { ReviewPhoto } from "@/lib/inspections/review/photos";
import { MODULE_REGISTRY } from "@/modules/registry";
import { History } from "./history";
import { InspectionFacts } from "./inspection-facts";
import { formatCustomValue, ModuleResults } from "./module-results";
import { ReportPhotos } from "./report-photos";
import { StatusNotice } from "./status-notice";
import { SwitchedOffModules } from "./switched-off-modules";
import { Verdict } from "./verdict";

/** Text content without tags, for reading order. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * The text as textContent has it, which is what a screen reader reads and a
 * copy takes: tags dropped without adding spaces, so words in neighbouring
 * elements run together unless the markup spaces them.
 */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
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

describe("ModuleResults", () => {
  const html = renderToStaticMarkup(<ModuleResults evaluation={evaluated()} />);

  it("lists every included module and custom section in the template's order", () => {
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

  it("shows each result in the template's wording, with sizes as the template names them", () => {
    const visual = row(html, "module-visual");
    expect(visual).toContain('data-status="fail"');
    expect(text(visual)).toContain("Visual Inspection (AQL)");
    // lib/format's size names: the template labels M "Medium" and L "L".
    expect(text(visual)).toMatch(/Size Medium Passed .*Size L Failed/);
  });

  it("keeps a size, its result and its summary apart when read out", () => {
    expect(plain(row(html, "module-visual"))).toMatch(/Size Medium Passed .*Size L Failed/);
  });

  it("sizes every result pill like the capture kit's: 16 px text on the iPad", () => {
    const pills = [...row(html, "module-visual").matchAll(/<span data-slot="status-pill"[^>]*class="([^"]*)"/g)];
    // The module's own result, then one per ordered size.
    expect(pills).toHaveLength(3);
    for (const [, classes] of pills) expect(classes).toContain("touch:text-base");
  });

  it("puts the inspector's comment beside the result", () => {
    expect(text(row(html, "module-visual"))).toContain("One embedded insect in size L.");
    expect(text(row(html, "module-header"))).toContain("No comment from the inspector");
  });

  it("lists errors and warnings under their module, in words as well as colour", () => {
    expect(text(row(html, "module-carton_sampling"))).toContain("Error: Carton 2 is entered twice for size M.");
    expect(row(html, "module-carton_sampling")).toContain('data-level="error"');
    expect(text(row(html, "module-weight"))).toContain("Warning: Average 2.8 g is 20% below the indicative 3.5 g.");
  });

  it("does not repeat 'not done' as a warning under a module that says Not done", () => {
    const notDone = renderToStaticMarkup(
      <ModuleResults
        evaluation={evaluated({ data: { ...savedData(), modules: { ...savedData().modules, packing_config: {} } } })}
      />,
    );
    const packing = row(notDone, "module-packing_config");
    expect(packing).toContain('data-status="not_done"');
    expect(packing).not.toContain('data-issue="module_not_done"');
  });

  it("shows a custom section's values with units", () => {
    const custom = text(row(html, "custom-glove_type"));
    expect(custom).toContain("Extra fields");
    expect(custom).toMatch(/Glove type Powder-free Sterile No Length 240 mm/);
  });

  it("leaves clearing the top bar to the page's scroll padding: no scroll margin of its own", () => {
    // app/globals.css keeps the bar and 1rem above a section or row a link scrolls to; a
    // margin on top of that would leave the bar's height again.
    const section = /<section id="modules"[^>]*>/.exec(html)?.[0] ?? "";
    const visual = /<li id="module-visual"[^>]*>/.exec(html)?.[0] ?? "";
    expect(section).toContain('aria-labelledby="modules-heading"');
    expect(visual).toContain("grid");
    for (const tag of [section, visual]) expect(tag).not.toContain("scroll-mt");
    expect(html).not.toContain("--shell-top");
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
  // The real modules, whose summaries often string the sizes' lines together.
  const html = renderToStaticMarkup(
    <ModuleResults
      evaluation={evaluateStoredInspection(
        storedInspection({ resolved: stdEgTemplate(), data: stdEgInspectionData() }),
        MODULE_REGISTRY,
      )}
    />,
  );
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it.each([
    ["module-watertight", "1 / 500 (Finger 1), Defect Limit 14 / 15: Passed"],
    ["module-dispensing_packing", "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed"],
    ["module-carton_sampling", "50 carton numbers, unique and between 1 and 2,900"],
  ])("says %s's result for size M once, on the size's line", (id, sentence) => {
    const found = text(row(html, id));
    expect(count(found, sentence)).toBe(1);
    expect(found).toMatch(new RegExp(`Size M Passed ${sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("keeps what a summary adds to the sizes' lines: force at break's spec", () => {
    const found = text(row(html, "module-force_at_break"));
    expect(count(found, "Median 6.537 N")).toBe(1);
    expect(found).toContain("Spec. ≥ 6 N. Size M Passed Median 6.537 N");
  });

  it("keeps a headline that says something of its own", () => {
    expect(text(row(html, "module-dimensions"))).toContain("Median within spec for size M. Size M Passed Median: Length 245");
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
  it("sets the inspector's final result and remark beside the app's suggestion", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated()} />));
    expect(html).toContain("Suggested by the app Failed Failed: Finished Goods Sampling Information (carton number), Visual Inspection (AQL). Warnings: Weight (g).");
    expect(html).toContain("Final result (inspector) Failed Remark Critical defect in size L.");
    expect(html).not.toContain("differs from the suggested result");
    expect(html).toContain("1 error");
    expect(html).toContain("1 warning");
    expect(html).toContain("Every module is done");
    expect(html).toContain("9 modules in this inspection.");
  });

  it("says why under the suggestion, a line each, and nothing more for a clean pass", () => {
    const html = renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated()} />);
    const reasons = html.match(/<ul data-slot="suggested-reasons"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
    expect([...reasons.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1])).toEqual([
      "Failed: Finished Goods Sampling Information (carton number), Visual Inspection (AQL).",
      "Warnings: Weight (g).",
    ]);

    const evaluation = evaluated();
    if (!evaluation.ok) throw new Error("the review fixture does not evaluate");
    // A stale summary that restates the result: the review says why from the lists, never the summary.
    const clean = {
      ...evaluation,
      report: { ...evaluation.report, suggested: { result: "pass" as const, failed: [], notDone: [], warned: [], summary: "Pass." } },
    };
    const passed = renderToStaticMarkup(<Verdict inspection={reviewInspection({ result: "pass", savedSuggestion: "pass" })} evaluation={clean} />);
    expect(passed).not.toContain('data-slot="suggested-reasons"');
    expect(text(passed)).toContain("Suggested by the app Passed Final result (inspector) Passed");
    expect(text(passed)).not.toMatch(/\bPass\b/);
  });

  it("points out a final result that differs, and a suggestion that changed since it was saved", () => {
    const html = text(
      renderToStaticMarkup(
        <Verdict inspection={reviewInspection({ result: "pass", savedSuggestion: "pass" })} evaluation={evaluated()} />,
      ),
    );
    expect(html).toContain("The final result differs from the suggested result.");
    expect(html).toContain("When the inspection was last saved, the app suggested passed.");
  });

  it("says when no final result is chosen yet", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection({ result: null, remarks: null })} evaluation={evaluated()} />));
    expect(html).toContain("Not chosen yet");
    expect(html).toContain("No remark");
  });

  it("explains when the results cannot be worked out", () => {
    const html = text(renderToStaticMarkup(<Verdict inspection={reviewInspection()} evaluation={evaluated({ data: null })} />));
    expect(html).toContain("Not available: the results could not be worked out.");
    expect(html).toContain("saved data could not be read");
  });
});

describe("StatusNotice", () => {
  it("gives a reopen's reason its own labelled box", () => {
    const html = renderToStaticMarkup(
      <StatusNotice
        notice={{ status: "reopened", title: "Reopened: changes needed", body: "An admin reopened it.", reason: { label: "What to change", text: "Retest size M." } }}
      />,
    );
    expect(html).toContain('<h2 id="review-status"');
    expect(html).toContain('data-status="reopened"');
    expect(text(html)).toContain("What to change Retest size M.");
  });
});

describe("InspectionFacts", () => {
  it("lists the facts, the approver as the viewer may know them, and the template version", () => {
    const html = text(
      renderToStaticMarkup(
        <InspectionFacts
          inspection={reviewInspection({ status: "approved", approvedAt: "2026-10-06T07:00:00+00:00", approver: { kind: "admin" } })}
          template={{ id: "t", code: "TEST_EG", version: 3, name: "Test examination gloves" }}
        />,
      ),
    );
    expect(html).toContain("Manufacturer Manufacturer A · Plant 1");
    expect(html).toContain("Lot numbers LOT-M-0001, LOT-L-0001");
    expect(html).toContain("Inspection date 5 Oct 2026");
    expect(html).toContain("Approved 6 Oct 2026, 15:00 by an admin");
    expect(html).toContain("Template TEST_EG version 3 Test examination gloves");
  });

  it("keeps the second line of a fact apart from the first when read out", () => {
    const html = plain(
      renderToStaticMarkup(
        <InspectionFacts
          inspection={reviewInspection({ status: "approved", approvedAt: "2026-10-06T07:00:00+00:00", approver: { kind: "admin" } })}
          template={{ id: "t", code: "TEST_EG", version: 3, name: "Test examination gloves" }}
        />,
      ),
    );
    expect(html).toContain("6 Oct 2026, 15:00 by an admin");
    expect(html).toContain("TEST_EG version 3 Test examination gloves");
  });

  it("says what is missing instead of leaving gaps", () => {
    const html = text(
      renderToStaticMarkup(
        <InspectionFacts inspection={reviewInspection({ client: null, poNo: null, lotNumbers: [], submittedAt: null })} template={null} />,
      ),
    );
    expect(html).toContain("Client — No client");
    expect(html).toContain("PO — No PO yet");
    expect(html).toContain("Submitted — Not submitted yet");
    expect(html).toContain("Template — Template not readable");
  });
});

describe("SwitchedOffModules", () => {
  it("lists each module switched off for this inspection with its reason", () => {
    const html = text(
      renderToStaticMarkup(
        <SwitchedOffModules
          overrides={[{ key: "weight", title: "Weight (g)", reason: "Scale broken.", by: { kind: "admin" }, at: "2026-10-05T03:00:00Z" }]}
        />,
      ),
    );
    expect(html).toContain("Weight (g) Reason: Scale broken. Switched off by an admin on 5 Oct 2026, 11:00");
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
    const html = renderToStaticMarkup(
      <ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [photo], total: 4, failed: false }} canChoose />,
    );
    expect(text(html)).toContain("1 of 4 photos marked for the report.");
    expect(html).toMatch(/<a href="https:\/\/storage.example.com\/full.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open full size, in a new tab: Insect in the cuff/);
    expect(html).toContain('src="https://storage.example.com/thumb.jpg"');
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${INSPECTION_ID}/photos"[^>]*>.*All photos \\(4\\)`));
  });

  it.each([
    [0, true, "No photos have been taken for this inspection."],
    [3, true, "None of the photos is marked for the report yet. Choose them in All photos."],
    [3, false, "None of the photos is marked for the report yet. An admin chooses them."],
  ])("with %i photos (admin: %s) says %j", (total, canChoose, words) => {
    const html = text(renderToStaticMarkup(<ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [], total, failed: false }} canChoose={canChoose} />));
    expect(html).toContain(words);
  });

  it("says when photos could not be loaded, without claiming there are none", () => {
    const html = text(renderToStaticMarkup(<ReportPhotos inspectionId={INSPECTION_ID} photos={{ items: [], total: null, failed: true }} canChoose />));
    expect(html).toContain("Some photos could not be loaded.");
    expect(html).not.toContain("None of the photos");
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

  it("lists who did what and when, oldest first, with the reason for a reopen", () => {
    const html = text(renderToStaticMarkup(<History history={{ entries, failed: false }} />));
    expect(html).toContain("Created by the system · 5 Oct 2026, 09:00");
    expect(html).toContain("Reopened by an admin · 6 Oct 2026, 10:00 Reason: Retest size M.");
  });

  it("keeps what happened apart from who did it when read out", () => {
    const html = plain(renderToStaticMarkup(<History history={{ entries, failed: false }} />));
    expect(html).toContain("Created by the system · 5 Oct 2026, 09:00");
    expect(html).toContain("Reopened by an admin");
  });

  it("says when the history could not be loaded", () => {
    expect(text(renderToStaticMarkup(<History history={{ entries: [], failed: true }} />))).toContain(
      "The history could not be loaded.",
    );
  });
});
