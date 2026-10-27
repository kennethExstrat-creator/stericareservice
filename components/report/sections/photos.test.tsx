// The photo records' pages as server-rendered markup, in the report's own
// frame (TG35 pages 9 to 11): the kicker and title, each group under its
// heading with its note, the design's grids, the export's images, a defect
// named in bold among plain captions.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { buildReportModel } from "@/lib/report/model";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { PhotoGrid } from "../photo-grid";
import { ReportDocument } from "../report-document";

const pagesOf = (html: string) => html.split("<section data-report-page").slice(1);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const recordPages = (doc: InspectionExport) =>
  pagesOf(renderToStaticMarkup(<ReportDocument model={buildReportModel(doc)} />)).filter((page) => page.includes('data-slot="report-photo-record"'));

let next = 0;
function photo(moduleKey: string, target: string | null = null, caption: string | null = null): ExportPhoto {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(800000 + next).padStart(12, "0")}`,
    url: `https://storage.example.com/inspection-photos/tile-${next}.jpg?token=placeholder`,
    moduleKey,
    target,
    caption,
    takenAt: null,
    includeInReport: false,
    flagged: false,
  };
}

describe("the photo records' pages", () => {
  const doc = makeStdEgExport();
  const model = buildReportModel(doc);
  const pages = pagesOf(renderToStaticMarkup(<ReportDocument model={model} />));
  const records = pages.filter((page) => page.includes('data-slot="report-photo-record"'));

  it("print after the sections, a page per record, numbered across the report", () => {
    expect(records).toHaveLength(2);
    expect(pages.slice(-2)).toEqual(records);
    expect(records[1]).toContain(`Page ${model.pageCount} of ${model.pageCount}</p>`);
  });

  it("head each with its record and title, then each group under its heading with its note, the export's images and captions", () => {
    expect(text(records[0])).toContain("Photo Record 1 of 2 Packing, Visual & Ageing Glove Visual Inspection Thin spot on glove body");
    expect(text(records[1])).toContain(
      "Photo Record 2 of 2 Watertight & Laboratory Testing Watertight Testing for Pinholes 1 pinhole in 500 gloves Pin hole on a finger after the watertight test",
    );
    const visual = doc.photos.find((entry) => entry.moduleKey === "visual");
    expect(records[0]).toContain(`<img src="${visual?.url.replace(/&/g, "&amp;")}" alt="Glove Visual Inspection, Size M, Thin spot on glove body"`);
    // A defect named, in bold.
    expect(records[0]).toMatch(/<p class="text-slate-900 font-semibold[^"]*">Thin spot on glove body<\/p>/);
  });

  it("lay each group in the design's grid: the warehouse large beside four, labels four across, the watertight photos square five across", () => {
    const sampled = makeStdEgExport();
    sampled.photos = [
      ...Array.from({ length: 5 }, () => photo("media_warehouse")),
      photo("labeling", "size:M/level:carton"),
      photo("watertight", "size:M", "Test rig"),
      photo("watertight", "size:M/defect:hole_palm"),
    ];
    const [sampling, watertight] = recordPages(withReportOptions(sampled, { photos: { groups: { samplingPackaging: true, packingVisualAgeing: true, watertightLaboratory: true }, perGroup: 12 } }));
    expect(sampling).toMatch(/data-block="finishedGoods"[^>]*>.*?<ul data-slot="report-photo-grid" class="[^"]*grid-cols-4"><li data-photo="[^"]+" class="[^"]*col-span-2 row-span-2/);
    expect(sampling).toMatch(/data-block="cartonLabels".*?aspect-\[3\/2\].*?Size M<\/p>/);
    expect(text(sampling)).toContain("Finished Goods Sampling Manufacturer A · Factory A1 warehouse, 11 April 2025");
    expect(watertight).toMatch(/data-block="watertight".*?grid-cols-5.*?aspect-square/);
    // The rig as captioned, plain; the pinhole by its place, in bold.
    expect(watertight).toMatch(/<p class="text-slate-600[^"]*">Test rig<\/p>/);
    expect(watertight).toMatch(/<p class="text-slate-900 font-semibold[^"]*">Pin Hole, Palm<\/p>/);
  });
});

describe("PhotoGrid's photos", () => {
  it("take a 3/2 tile, and a caption in bold or not, photo by photo, whatever the grid's setting", () => {
    const html = renderToStaticMarkup(
      <PhotoGrid
        aspect="3/2"
        strongCaptions
        photos={[
          { id: "1", url: "https://storage.example.com/1.jpg", caption: "Inspection bench", strong: false },
          { id: "2", url: "https://storage.example.com/2.jpg", caption: "Thin spot" },
        ]}
      />,
    );
    expect(html).toContain("aspect-[3/2]");
    expect(html).toMatch(/<p class="text-slate-600[^"]*">Inspection bench<\/p>/);
    expect(html).toMatch(/<p class="text-slate-900 font-semibold[^"]*">Thin spot<\/p>/);
  });
});
