// Section 06's pages as server-rendered markup (TG35 page 6): the heading
// and lead, the grid of defects against each limit (a track per check, a
// chip for a limit of 0), the defect tables, the photos, a failing size in
// red, a section continued on a second page, the Minor class moved under
// the critical defects; and the primitives' props the section added
// (TrackBar's words alone and in red, ReportTable's plain look with a
// group's heading).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDocument, ReportTable, TrackBar } from "@/components/report";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { buildReportModel } from "@/lib/report/model";
import { fourSizeExport, fourSizeProductDefectsExport, placeholderPhoto } from "@/lib/report/sections/__fixtures__/holes-visual";
import type { InspectionExport } from "@/lib/schemas/export";

/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** The report's pages of Section 06, each with its number. */
function sectionPages(doc: InspectionExport): string[] {
  const html = renderToStaticMarkup(<ReportDocument model={buildReportModel(doc)} />);
  return html
    .split("<section data-report-page")
    .slice(1)
    .filter((page) => page.includes('data-slot="report-holes-visual"'));
}

/** The markup from an element with this attribute to the end of the element's own tag's kind, roughly: enough to look inside one part. */
function part(html: string, marker: string): string {
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`No ${marker}.`);
  const tag = html.lastIndexOf("<", start);
  const name = /^<(\w+)/.exec(html.slice(tag))?.[1] ?? "div";
  let depth = 0;
  const pattern = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
  pattern.lastIndex = tag;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(tag, match.index + match[0].length);
  }
  return html.slice(tag);
}

describe("STD_EG's Section 06, on one page", () => {
  const pages = sectionPages(makeStdEgExport());
  const page = pages[0];

  it("prints one page, numbered across the report, headed by the kicker, the title and the lead", () => {
    expect(pages).toHaveLength(1);
    // Of the report's 11: Section 08 runs on to a second page (its matrix holds the packing check's aged sample).
    expect(page).toContain("Page 6 of 11</p>");
    expect(text(part(page, 'data-slot="report-section-heading"'))).toBe(
      "Section 06 Freedom from Holes & Visual Inspection Watertight and visual checks on the same 500 gloves. Size M stayed inside every acceptance limit.",
    );
  });

  it("draws the defects against each limit: a track to the reject number, a chip where nothing may be found", () => {
    const grid = part(page, 'data-slot="report-defect-limits"');
    expect(text(grid)).toContain("Defects Found against Acceptance Limit Found Reject point Track ends at reject number");
    expect(text(grid)).toContain("Size Freedom from Holes AQL 1.5 Visual: Major AQL 2.5 Visual: Minor AQL 4.0 Visual: Critical AQL 0.0");
    // A size's row is 11 mm with its hairline (Kenneth, 27 October 2026).
    expect(part(grid, 'data-row="M"')).toContain('<div class="h-[10.75mm] pt-[0.8mm]">');
    expect(text(grid)).toContain("M n = 500 1 found · accept ≤ 14 8 found · accept ≤ 21 0 found · accept ≤ 21 0 found · accept 0 None");
    const holes = part(grid, 'data-cell="holes"');
    // 1 found of a track that ends at 15: a fifteenth filled, the last step tinted.
    expect(holes).toMatch(/data-slot="report-reject-zone"[^>]*style="left:93\.333%"/);
    expect(holes).toMatch(/data-slot="report-track-fill" class="[^"]*bg-brand-600[^"]*" style="width:6\.667%"/);
    const critical = part(grid, 'data-cell="critical"');
    expect(critical).not.toContain("report-reject-zone");
    expect(critical).toMatch(/data-slot="report-status-chip" data-status="pass"[^>]*>.*None<\/span>/);
  });

  it("lists the pinholes, the critical defects and the major and minor defects in the plain tables, a class under its blue heading", () => {
    const pinholes = part(page, 'data-table="pinholes"');
    expect(text(pinholes)).toBe(
      "Pinholes by Location Pinholes by Location Location M Samples Tested 500 Between Fingers (Crotch) 0 Palm 0 Finger 1 Cuff 0 Other 0 Total Found 1 Accept / Reject 14 / 15",
    );
    // A defect found in bold, a zero in grey, the total's row tinted under a rule, no hairlines between the rows.
    expect(pinholes).toMatch(/<span class="whitespace-nowrap font-bold text-slate-900">1<\/span>/);
    expect(pinholes).toMatch(/<span class="whitespace-nowrap text-slate-600">0<\/span>/);
    expect(pinholes).toMatch(/<tr data-row="pinholes:total" class="bg-brand-50 font-semibold border-t-\[0\.3mm\] border-slate-300">/);
    expect(pinholes).not.toContain("border-b-[0.25mm]");
    const visual = part(page, 'data-table="visual"');
    expect(visual).toMatch(/<tr data-row="major:group" data-kind="group" class="border-b-\[0\.3mm\] border-brand-200"><th colSpan="2" scope="rowgroup"/);
    expect(text(visual)).toContain("Samples Inspected 500 Major · AQL 2.5 Thin Area Between Fingers (Crotch) 2");
    expect(text(visual)).toContain("Total Major 8 Accept / Reject 21 / 22 Minor · AQL 4.0 Small Dirt / Stain 0");
    expect(text(part(page, 'data-table="critical"'))).toContain("AQL 0.0 · Accept 0 M Embedded Insects 0 Embedded Metal Debris 0 Total Critical 0");
  });

  it("shows the defect photos with their captions, and lays the parts out in the design's two columns", () => {
    const photos = part(page, 'data-slot="report-defect-photos"');
    expect(photos).toContain('alt="Pin hole on a finger after the watertight test"');
    expect(text(photos)).toBe("Pin hole on a finger after the watertight test Thin spot on glove body");
    const columns = part(page, 'data-slot="report-holes-visual-columns"');
    expect(columns).toContain("grid-cols-[minmax(0,84fr)_minmax(0,93fr)]");
    const [left, right] = [part(columns, 'data-column="1"'), part(columns, 'data-column="2"')];
    expect(left).toContain('data-table="pinholes"');
    expect(left).toContain('data-table="critical"');
    expect(left).toContain('data-slot="report-defect-photos"');
    expect(right).toContain('data-table="visual"');
  });
});

describe("a failing size", () => {
  function failing(): InspectionExport {
    const doc = makeStdEgExport();
    const json = (key: string) => doc.modules.find((module) => module.key === key)?.computed as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const holes = json("watertight");
    holes.sizes.M = { ...holes.sizes.M, totalDefects: 15, holes: { ...holes.sizes.M.holes, hole_finger: 15 }, decision: "reject", result: "fail" };
    const visual = json("visual");
    visual.sizes.M.critical = { ...visual.sizes.M.critical, counts: { embedded_insect: 0, embedded_metal: 1 }, total: 1, decision: "reject", result: "fail" };
    return doc;
  }
  const page = sectionPages(failing())[0];

  it("draws its count and track red, and a Failed chip where nothing may be found", () => {
    const holes = part(page, 'data-cell="holes"');
    expect(holes).toContain('data-status="fail"');
    expect(holes).toMatch(/<p class="text-fail tabular-nums[^"]*">/);
    expect(holes).toMatch(/data-slot="report-track-fill" class="[^"]*bg-fail-solid/);
    const critical = part(page, 'data-cell="critical"');
    expect(text(critical)).toBe("1 found · accept 0 Failed");
    expect(critical).toMatch(/data-slot="report-status-chip" data-status="fail"/);
  });

  it("prints the total over its limit and any critical defect in red, and says so in the lead", () => {
    expect(part(page, 'data-row="pinholes:total"')).toMatch(/<span class="whitespace-nowrap font-bold text-fail">15<\/span>/);
    expect(part(page, 'data-row="critical:embedded_metal"')).toMatch(/<span class="whitespace-nowrap font-bold text-fail">1<\/span>/);
    expect(text(part(page, 'data-slot="report-section-heading"'))).toContain("Size M failed Freedom from Holes and Visual: Critical.");
  });
});

describe("SAFEDON_EG's Section 06 on Letter, continued on a second page", () => {
  const pages = sectionPages(withReportOptions(makeSafedonExport(), { pageSize: "letter" }));

  it("prints two pages, the second headed as continued, the visual table going on from its Minor class under its heading", () => {
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Page 8 of 12</p>");
    expect(pages[1]).toContain("Page 9 of 12</p>");
    expect(text(part(pages[1], 'data-slot="report-section-heading"'))).toBe("Section 06 · Continued Freedom from Holes & Visual Inspection");
    const continued = part(pages[1], 'data-table="visual"');
    expect(continued).toContain('data-continued="true"');
    expect(text(continued)).toMatch(/^Visual: Major & Minor Defects Continued Visual: Major & Minor Defects, continued Defect XS S M L Minor · AQL 4\.0 Small Dirt \/ Stain 0 0 0 0/);
    expect(pages[1]).not.toContain("report-defect-limits");
  });
});

describe("four sizes, S to XL: the Minor class under the critical defects", () => {
  const pages = sectionPages(fourSizeExport());

  it("prints one page: the holes, the critical defects and the Minor class down the left column, the major defects down the right", () => {
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Page 7 of 10</p>");
    const columns = part(pages[0], 'data-slot="report-holes-visual-columns"');
    const [left, right] = [part(columns, 'data-column="1"'), part(columns, 'data-column="2"')];
    expect(left).toContain('data-table="pinholes"');
    expect(left).toContain('data-table="critical"');
    const minor = part(left, 'data-table="visual"');
    // No heading over it: the table's own header row and the class's heading.
    expect(minor).not.toContain("<h3");
    expect(text(minor)).toMatch(/^Visual: Major & Minor Defects, continued Defect S M L XL Minor · AQL 4\.0 Small Dirt \/ Stain 2 1 0 0 /);
    expect(text(minor)).toMatch(/ Total Minor 2 2 0 1 Accept \/ Reject 14 \/ 15 21 \/ 22 14 \/ 15 10 \/ 11$/);
    const major = text(part(right, 'data-table="visual"'));
    expect(major).toMatch(/^Visual: Major & Minor Defects Visual: Major & Minor Defects Defect S M L XL Samples Inspected 200 315 200 125 /);
    expect(major).toMatch(/ Ring mark Defect Not in the List 0 1 0 0 Total Major 3 5 1 1 Accept \/ Reject 10 \/ 11 14 \/ 15 10 \/ 11 7 \/ 8$/);
  });
});

describe("the defect photos: never a page of their own, captioned as the design captions them", () => {
  it("leave INS-2026-2442's four Product Defects photos to the photo records: one page, no 'Section 06 · Continued' of photos", () => {
    for (const described of [false, true]) {
      const doc = fourSizeProductDefectsExport({ described });
      const pages = sectionPages(doc);
      expect(pages).toHaveLength(1);
      expect(pages[0]).not.toContain("report-defect-photos");
      expect(pages[0]).not.toContain("Product Defects");
    }
  });

  it("print a photo Steri-AI describes under the critical defects, its caption plain as TG35 page 6 sets it, the ring drawn on it", () => {
    const doc = makeStdEgExport();
    doc.photos = [
      placeholderPhoto(1, {
        moduleKey: "media_defects",
        markers: [{ x: 0.62, y: 0.4, r: 0.06 }],
        description: { text: "Pinhole, palm area", kind: "defect", defect: "hole_palm", location: "hole_palm", clarity: 0.9 },
      }),
      placeholderPhoto(2, { moduleKey: "media_defects", description: { text: "Test rig", kind: "context", defect: null, location: null, clarity: 0.9 } }),
    ];
    const [page] = sectionPages(doc);
    const left = part(part(page, 'data-slot="report-holes-visual-columns"'), 'data-column="1"');
    const photos = part(left, 'data-slot="report-defect-photos"');
    // Under the tables, so no heading of its own; the rig, the setting, never comes.
    expect(text(photos)).toBe("Pinhole, palm area");
    expect(photos).toMatch(/<p class="text-slate-600[^"]*">Pinhole, palm area<\/p>/);
    expect(photos).not.toMatch(/font-semibold[^"]*">Pinhole, palm area/);
    expect(photos).toMatch(/<svg aria-hidden="true" data-slot="report-photo-rings"[^>]*viewBox="0 0 133.33 100"[^>]*><circle cx="82.67" cy="40" r="6"/);
  });
});

describe("the primitives' props this section added", () => {
  it("TrackBar: the words alone with bar off, in red when failed; unchanged otherwise", () => {
    const alone = renderToStaticMarkup(<TrackBar found={0} accept={0} reject={1} bar={false} />);
    expect(text(alone)).toBe("0 found · accept 0");
    expect(alone).not.toContain("report-reject-zone");
    expect(renderToStaticMarkup(<TrackBar found={3} accept={2} reject={3} failed />)).toMatch(/<p class="text-fail tabular-nums/);
    expect(renderToStaticMarkup(<TrackBar found={1} accept={2} />)).toMatch(/<p class="text-slate-900 tabular-nums/);
  });

  it("ReportTable: plain rows with no hairlines, a rule over a total, and a group's heading across the columns", () => {
    const html = renderToStaticMarkup(
      <ReportTable
        plain
        columns={[
          { key: "defect", label: "Defect" },
          { key: "S", label: "S", numeric: true },
        ]}
        rows={[
          { key: "group", group: true, cells: { defect: "Major · AQL 2.5" } },
          { key: "thin", cells: { defect: "Thin Spot", S: "2" } },
          { key: "total", emphasis: true, cells: { defect: "Total", S: "2" } },
        ]}
      />,
    );
    expect(html).toMatch(/<tr data-row="group" data-kind="group" class="border-b-\[0\.3mm\] border-brand-200"><th colSpan="2" scope="rowgroup" class="px-\[1\.6mm\] pt-\[1\.4mm\] pb-\[0\.5mm\][^"]*">Major · AQL 2\.5<\/th><\/tr>/);
    expect(html).toMatch(/<tr data-row="thin" class="">/);
    expect(html).toMatch(/<tr data-row="total" class="bg-brand-50 font-semibold border-t-\[0\.3mm\] border-slate-300">/);
    expect(html).toContain("py-[0.5mm]");
    expect(html).toContain("leading-[1.2]");
  });
});
