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
    description: null,
    markers: [],
    size: { width: 4032, height: 3024 },
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

describe("the rings drawn on a photo", () => {
  const ring = (markup: string) => [...markup.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"([^>]*)>/g)].map((match) => [Number(match[1]), Number(match[2]), Number(match[3]), match[4]]);
  const grid = (props: Parameters<typeof PhotoGrid>[0]) => renderToStaticMarkup(<PhotoGrid {...props} />);

  it("sit over a wide photo's square tile where the crop puts them, in the fail red, half a millimetre wide, clipped to the tile", () => {
    const html = grid({ aspect: "1/1", photos: [{ id: "1", url: "https://storage.example.com/1.jpg", markers: [{ x: 0.25, y: 0.4, r: 0.05 }], size: { width: 4000, height: 3000 } }] });
    // The SVG lies over the image in the tile's own box (100 tall), which clips it: the tile keeps its height.
    expect(html).toMatch(
      /<div class="relative overflow-hidden rounded-\[2mm\] bg-slate-100 aspect-square"><img [^>]+><svg aria-hidden="true" data-slot="report-photo-rings" class="pointer-events-none absolute inset-0 size-full text-fail" viewBox="0 0 100 100" preserveAspectRatio="none">/,
    );
    expect(ring(html)).toEqual([[16.67, 40, 5, ' fill="none" stroke="currentColor" stroke-width="0.5mm" vector-effect="non-scaling-stroke"']]);
  });

  it("sit over a tall photo's 3/2 tile as its crop moves them, and leave out a ring cropped away whole", () => {
    const html = grid({
      aspect: "3/2",
      photos: [
        {
          id: "1",
          url: "https://storage.example.com/1.jpg",
          markers: [
            { x: 0.5, y: 0.5, r: 0.1 },
            { x: 0.5, y: 0.1, r: 0.05 },
          ],
          size: { width: 3000, height: 4000 },
        },
      ],
    });
    expect(html).toContain('viewBox="0 0 150 100"');
    expect(ring(html).map((entry) => entry.slice(0, 3))).toEqual([[75, 50, 15]]);
  });

  it("are drawn in the image's own pixels on the large photo, whose box takes its rows' height, cropped as the image is", () => {
    const tile = (id: string) => ({ id, url: `https://storage.example.com/${id}.jpg` });
    const html = grid({ lead: true, aspect: "3/2", photos: [{ ...tile("lead"), markers: [{ x: 0.5, y: 0.25, r: 0.1 }], size: { width: 4000, height: 3000 } }, tile("2"), tile("3")] });
    expect(html).toContain('viewBox="0 0 4000 3000" preserveAspectRatio="xMidYMid slice"');
    expect(ring(html).map((entry) => entry.slice(0, 3))).toEqual([[2000, 750, 300]]);
  });

  it("are not drawn without the image's size, nor without rings", () => {
    const photo = { id: "1", url: "https://storage.example.com/1.jpg" };
    expect(grid({ photos: [{ ...photo, markers: [{ x: 0.5, y: 0.5, r: 0.1 }], size: null }] })).not.toContain("<svg");
    expect(grid({ photos: [{ ...photo, markers: [], size: { width: 4000, height: 3000 } }] })).not.toContain("<svg");
  });

  it("print on a photo record's tile, the group's note saying so", () => {
    const doc = makeStdEgExport();
    doc.photos = [{ ...photo("visual", "size:M/defect:thin_spot", "Thin spot"), markers: [{ x: 0.5, y: 0.5, r: 0.05 }] }];
    const [visual] = recordPages(doc);
    expect(text(visual)).toContain("Glove Visual Inspection Defects circled in red Thin spot");
    expect(visual).toMatch(/data-slot="report-photo-rings"[^>]*viewBox="0 0 100 100"/);
    expect(visual).toContain('<span class="whitespace-nowrap">Defects circled in red</span>');
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
