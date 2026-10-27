// Section 02's pages as server-rendered markup (TG35 page 2): the heading
// and lead, Glove Information beside Packing Configuration, the order lots
// and sampling plan table, the box/carton strips, what the app judged wrong
// in the status colours, and the strips continued on a second page.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeStdEgExport, withReportOptions } from "@/lib/report/__fixtures__/exports";
import { buildReportModel, reportPageChrome } from "@/lib/report/model";
import { orderExport } from "@/lib/report/sections/__fixtures__/order-sampling";
import type { InspectionExport } from "@/lib/schemas/export";
import { ReportDocument, reportBodies } from "../index";

/** Section 02's pages as markup, one per page, in their frames. */
function pagesOf(doc: InspectionExport): string[] {
  const model = buildReportModel(doc);
  const pages = reportBodies(model).filter((page) => page.key.startsWith("orderSampling-"));
  const html = renderToStaticMarkup(<ReportDocument paper={model.paper} chrome={reportPageChrome(model.chrome)} pages={pages} />);
  return html.split("<section data-report-page").slice(1);
}

/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("Section 02's page", () => {
  const [page] = pagesOf(makeStdEgExport());

  it("is headed Section 02 with its lead, and sets the glove's details beside its packing", () => {
    expect(text(page)).toContain(
      "Section 02 Order, Product & Sampling What was ordered, how it is packed, and which cartons were drawn for inspection. Sizes XS, S, L and XL were not on this order.",
    );
    expect(text(page)).toContain(
      "Glove Information Glove Surface Texture Finger-textured Glove Colour Blue Indicative Weight (Size M) 3.5 g Glove Length 240 mm minimum Glove Type Nitrile, powder free Factory Glove Code Not stated",
    );
    expect(page).toMatch(/data-slot="report-colour-swatch" class="[^"]*" style="background-color:#2563eb"/);
    expect(page).toMatch(/<dd class="[^"]*text-slate-600[^"]*">Not stated<\/dd>/);
    expect(page).toMatch(/data-slot="report-order-cards" class="grid gap-\[4\.6mm\] grid-cols-2"/);
  });

  it("draws the packing as three tiles, the gloves per case tinted teal", () => {
    expect(text(page)).toContain("Packing Configuration 200 gloves per inner box 10 inner boxes per case 2,000 gloves per case");
    const tiles = Array.from(page.matchAll(/data-slot="report-packing-tile" data-tile="(\w+)" class="([^"]*)"/g), ([, key, classes]) => [key, classes]);
    expect(tiles.map(([key]) => key)).toEqual(["glovesPerInner", "innersPerCase", "glovesPerCase"]);
    expect(tiles[0][1]).toContain("bg-brand-50");
    expect(tiles[2][1]).toContain("bg-accent-50");
    expect(page).toMatch(/text-accent-700[^"]*">2,000</);
  });

  it("tables the order lots and sampling plan as the design groups them, each size then the totals", () => {
    expect(text(page)).toContain("Order Lots & Sampling Plan Order Sampling Quantity Gloves per Test Boxes");
    expect(text(page)).toContain("Size Lot Number Cases Gloves Share Cases Inner Boxes Gloves Watertight & Visual Dimension FAB Packaging & Dispensing");
    expect(text(page)).toContain("M LOT-A01 2,900 5,800,000 100% 50 50 500 500 13 13 13 Total 2,900 5,800,000 100% 50 50 500 500 13 13 13");
    expect(page).toMatch(/data-slot="report-share-bar" data-share="100" class="[^"]*"><span class="[^"]*bg-brand-500" style="width:100%">/);
    expect(Array.from(page.matchAll(/<col style="width:[\d.]+%"\/>/g))).toHaveLength(12);
  });

  it("places every sampled box/carton number on the size's strip, with the numbers under it and the lot's range", () => {
    expect(text(page)).toContain("Finished Goods Sampling (Box/Carton #) One sampled carton, placed by its number in the lot");
    expect(text(page)).toContain("50 cartons were opened, spread from the start to the end of the lot.");
    expect(Array.from(page.matchAll(/data-mark="\d+"/g))).toHaveLength(50);
    expect(text(page)).toMatch(/M 50 of 2,900 013 112 174 .* 2854 1–2,900/);
    expect(page).not.toContain("data-failing");
  });
});

describe("what the app judged wrong", () => {
  const [page] = pagesOf(
    orderExport({
      S: { cases: 100, sampled: { cases: 3 }, cartons: [5, 50, 120] },
      M: { cases: 200, sampled: { cases: 3, watertightVisual: 130 }, cartons: [10, 10, 100, 190] },
      L: { cases: 10, sampled: { cases: 12 }, cartons: [1, 5] },
    }),
  );

  it("prints a box/carton number outside the lot or entered twice in fail red, and its mark", () => {
    expect(page).toMatch(/data-mark="120" data-failing="true" class="[^"]*bg-fail-solid/);
    expect(page).toContain('<span data-carton="120" class="font-semibold text-fail">120</span>');
    expect(Array.from(page.matchAll(/<span data-carton="10" class="font-semibold text-fail">010<\/span>/g))).toHaveLength(2);
    expect(page).toContain('<span data-carton="50">050</span>');
  });

  it("prints more box/carton numbers than the cases sampled in fail red", () => {
    expect(page).toMatch(/data-slot="report-carton-count" class="font-semibold text-fail">4(<!-- -->)? of (<!-- -->)?200</);
    expect(page).toMatch(/data-slot="report-carton-count">3(<!-- -->)? of (<!-- -->)?100</);
  });

  it("prints a sampling count in error in fail red and one with a warning in amber", () => {
    expect(page).toContain('data-tone="fail" class="font-semibold text-fail">12</span>');
    expect(page).toContain('data-tone="warn" class="font-semibold text-warn">130</span>');
  });
});

describe("missing data and the blocks switched on", () => {
  it("says Not stated for a packing count or a size's box/carton numbers not entered, and dashes a count not entered", () => {
    const [page] = pagesOf(
      orderExport(
        { S: { cases: 1200 }, M: { cases: 2000, sampled: { cases: null, innerUnits: null } } },
        { packing: { glovesPerInner: null, innersPerCase: 10, glovesPerCase: 1000 } },
      ),
    );
    expect(page).toMatch(/data-tile="glovesPerInner" class="[^"]*"><p class="[^"]*text-slate-600[^"]*">Not stated<\/p>/);
    expect(text(page)).toMatch(/M LOT-M1 2,000 2,000,000 [\d.]+% — — 200/);
    expect(text(page)).toContain("M 0 of 2,000 Not stated 1–2,000");
  });

  it("sets a card alone across the page", () => {
    const doc = makeStdEgExport();
    const blocks = { ...doc.report.sections.orderSampling.blocks, gloveInformation: false };
    const [page] = pagesOf(withReportOptions(doc, { sections: { ...doc.report.sections, orderSampling: { include: true, blocks } } }));
    expect(page).toMatch(/data-slot="report-order-cards" class="grid gap-\[4\.6mm\] grid-cols-1"/);
    expect(page).toContain("max-w-[110mm]");
    expect(text(page)).not.toContain("Glove Information");
  });
});

describe("a second page", () => {
  const pages = pagesOf(
    orderExport({
      XS: { cases: 900, sampled: { cases: 30 } },
      S: { cases: 2400, sampled: { cases: 49 } },
      M: { cases: 3100, sampled: { cases: 56 } },
      L: { cases: 2600, sampled: { cases: 51 } },
      XL: { cases: 700, sampled: { cases: 27 } },
    }),
  );

  it("continues the strips under Section 02 · Continued, the block's heading again and no summary", () => {
    expect(pages).toHaveLength(2);
    expect(text(pages[0])).toContain("cartons were opened");
    expect(text(pages[1])).toContain("Section 02 · Continued Order, Product & Sampling Finished Goods Sampling (Box/Carton #) One sampled carton");
    expect(text(pages[1])).not.toContain("cartons were opened");
    expect(text(pages[1])).not.toContain("What was ordered");
    expect(pages[1]).toContain('data-slot="report-carton-strips" data-continued="true"');
    expect(Array.from(pages[1].matchAll(/data-row="(\w+)-0"/g), ([, size]) => size)).toEqual(["M", "L", "XL"]);
  });
});
