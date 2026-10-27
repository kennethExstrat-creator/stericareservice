// Section 02, Order, Product & Sampling (TG35 page 2): its blocks from the
// placeholder example reports (STD_EG: size M; SAFEDON_EG: sizes XS to L)
// and from variants of SAFEDON_EG's data run through the real modules, in
// the template's wording, with the app's checks; the blocks switched off;
// and how the blocks fill the pages.
//
// The model is imported first: it loads the sections' registry, which the
// builder's defineSection comes from (lib/report/sections/index.ts).
import { describe, expect, it } from "vitest";
import { buildReportModel, type ReportSectionPlanEntry } from "../model";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import type { InspectionExport } from "@/lib/schemas/export";
import { orderExport, spreadCartons } from "./__fixtures__/order-sampling";
import {
  CARTON_LEGEND,
  cartonSummary,
  leadOf,
  ORDER_SAMPLING_LEAD,
  orderSampling,
  paddedCarton,
  pluralOf,
  testCaption,
  type CartonRow,
  type CartonStrips,
  type GloveCard,
  type OrderSamplingContent,
} from "./order-sampling";
import { captionText, layoutOrderSampling, lineStarts, ORDER_SAMPLING_ROOM, stripHeight, textWidth, trackWidth, twoLineWidth, wrappedLines } from "./order-sampling-layout";

function sectionOf(doc: InspectionExport): OrderSamplingContent {
  const content = buildReportModel(doc).sections.orderSampling;
  if (!content) throw new Error("Section 02 was not built.");
  return content;
}

function entryOf(doc: InspectionExport): ReportSectionPlanEntry<"orderSampling"> {
  const entry = buildReportModel(doc).plan.find((candidate) => candidate.key === "orderSampling");
  if (!entry || entry.kind !== "section") throw new Error("Section 02 is not planned.");
  return entry as ReportSectionPlanEntry<"orderSampling">;
}

function withBlocks(doc: InspectionExport, blocks: Partial<Record<"gloveInformation" | "packingConfiguration" | "orderLotsSampling" | "finishedGoodsSampling", boolean>>): InspectionExport {
  const current = doc.report.sections.orderSampling;
  return withReportOptions(doc, { sections: { ...doc.report.sections, orderSampling: { ...current, blocks: { ...current.blocks, ...blocks } } } });
}

function moduleIn(doc: InspectionExport, key: string) {
  const found = doc.modules.find((module) => module.key === key);
  if (!found) throw new Error(`No ${key} in the export.`);
  return found;
}

const FOUR_SIZES = { S: { cases: 1200 }, M: { cases: 2000 }, L: { cases: 1000 }, XL: { cases: 300 } } as const;

describe("Section 02 in the report", () => {
  it("follows the Summary as Section 02, built, a page for each example report", () => {
    for (const doc of [makeStdEgExport(), makeSafedonExport()]) {
      expect(entryOf(doc)).toMatchObject({ number: 2, kicker: "Section 02", title: "Order, Product & Sampling", built: true, pageCount: 1 });
    }
    expect(orderSampling.key).toBe("orderSampling");
  });

  it("leads with what it shows, naming the template's sizes not on the order", () => {
    expect(sectionOf(makeStdEgExport()).lead).toBe(`${ORDER_SAMPLING_LEAD} Sizes XS, S, L and XL were not on this order.`);
    expect(sectionOf(makeSafedonExport()).lead).toBe(`${ORDER_SAMPLING_LEAD} Size XL was not on this order.`);
    const template = { sizes: [{ value: "S", label: "S" }, { value: "M", label: "M" }] };
    expect(leadOf({ template } as InspectionExport, ["S", "M"])).toBe(ORDER_SAMPLING_LEAD);
    // Nothing ordered yet: no size is named.
    expect(leadOf({ template } as InspectionExport, [])).toBe(ORDER_SAMPLING_LEAD);
  });
});

describe("Glove Information", () => {
  it("lists the glove in the design's order by the template's labels, a listed colour with its swatch, a blank one Not stated", () => {
    expect(sectionOf(makeStdEgExport()).glove).toEqual({
      title: "Glove Information",
      facts: [
        { key: "surfaceTexture", label: "Glove Surface Texture", value: "Finger-textured", stated: true, swatch: null },
        { key: "colour", label: "Glove Colour", value: "Blue", stated: true, swatch: "#2563eb" },
        { key: "indicativeWeight", label: "Indicative Weight (Size M)", value: "3.5 g", stated: true, swatch: null },
        // The dimensions' length spec is 240 mm minimum for size M.
        { key: "length", label: "Glove Length", value: "240 mm minimum", stated: true, swatch: null },
        { key: "gloveType", label: "Glove Type", value: "Nitrile, powder free", stated: true, swatch: null },
        { key: "factoryGloveCode", label: "Factory Glove Code", value: "Not stated", stated: false, swatch: null },
      ],
    } satisfies GloveCard);
  });

  it("leaves out what the template switches off, and says minimum only where the spec's minimum is the glove's length", () => {
    const facts = sectionOf(makeSafedonExport()).glove?.facts ?? [];
    // SAFEDON_EG's header has no Factory Glove Code; its colour is not a listed one; its length spec is at least 230 mm.
    expect(facts.map((fact) => [fact.label, fact.value, fact.swatch])).toEqual([
      ["Glove Surface Texture", "Finger-textured", null],
      ["Glove Colour", "Purple blue", null],
      ["Indicative Weight (Size M)", "3.2 g", null],
      ["Glove Length", "240 mm", null],
      ["Glove Type", "Not stated", null],
    ]);
    const doc = makeStdEgExport();
    const glove = moduleIn(doc, "glove_info");
    glove.config = { ...glove.config, fields: { gloveType: false, surfaceTexture: true, indicativeWeight: true, colour: false, length: true } };
    expect(sectionOf(doc).glove?.facts.map((fact) => fact.key)).toEqual(["surfaceTexture", "indicativeWeight", "length", "factoryGloveCode"]);
  });

  it("names each variant's sizes where an inspection was saved with several, and the weight's own size", () => {
    const doc = makeStdEgExport();
    const glove = moduleIn(doc, "glove_info");
    glove.data = {
      gloveType: null,
      variants: [
        { sizes: ["S", "M"], surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: 240 },
        { sizes: ["L"], surfaceTexture: "Finger-textured", indicativeWeight: 4.1, colour: "Black", length: 240 },
      ],
    };
    const facts = Object.fromEntries((sectionOf(doc).glove?.facts ?? []).map((fact) => [fact.key, fact]));
    expect(facts.colour).toMatchObject({ value: "Blue (S, M); Black (L)", swatch: null });
    expect(facts.indicativeWeight).toMatchObject({ label: "Indicative Weight", value: "3.5 g (S, M); 4.1 g (L)" });
    expect(facts.surfaceTexture.value).toBe("Finger-textured");
    glove.data = { gloveType: null, variants: [{ sizes: ["L"], surfaceTexture: null, indicativeWeight: 4.1, colour: null, length: null }] };
    expect(sectionOf(doc).glove?.facts.find((fact) => fact.key === "indicativeWeight")).toMatchObject({ label: "Indicative Weight (Size L)", value: "4.1 g" });
  });

  it("is left out when nothing about the glove is recorded", () => {
    const doc = makeStdEgExport();
    moduleIn(doc, "glove_info").data = { gloveType: null, variants: [] };
    moduleIn(doc, "header").data = { ...moduleIn(doc, "header").data, factoryGloveCode: null };
    expect(sectionOf(doc).glove).toBeNull();
  });
});

describe("Packing Configuration", () => {
  it("counts the gloves per inner unit, the inner units per case and the gloves per case, in the template's inner unit", () => {
    expect(sectionOf(makeStdEgExport()).packing).toEqual({
      title: "Packing Configuration",
      tiles: [
        { key: "glovesPerInner", value: 200, caption: "gloves per inner box" },
        { key: "innersPerCase", value: 10, caption: "inner boxes per case" },
        { key: "glovesPerCase", value: 2000, caption: "gloves per case" },
      ],
    });
    expect(sectionOf(makeSafedonExport()).packing?.tiles.map((tile) => [tile.value, tile.caption])).toEqual([
      [125, "gloves per plastic pack"],
      [16, "plastic packs per case"],
      [2000, "gloves per case"],
    ]);
  });

  it("works out the gloves per case not stored, leaves a count not entered empty, and is left out with none", () => {
    const doc = makeStdEgExport();
    const packing = moduleIn(doc, "packing_config");
    packing.data = { ...packing.data, glovesPerCase: null };
    expect(sectionOf(doc).packing?.tiles.map((tile) => tile.value)).toEqual([200, 10, 2000]);
    const partial = orderExport({ M: { cases: 500 } }, { packing: { glovesPerInner: null, innersPerCase: 10, glovesPerCase: 1000 } });
    expect(sectionOf(partial).packing?.tiles.map((tile) => tile.value)).toEqual([null, 10, 1000]);
    expect(sectionOf(orderExport({ M: { cases: 500 } }, { packing: null })).packing).toBeNull();
  });

  it("names a pouch and a dispenser box as their plurals", () => {
    expect(["inner box", "plastic pack", "dispenser box", "pouch"].map(pluralOf)).toEqual(["inner boxes", "plastic packs", "dispenser boxes", "pouches"]);
  });
});

describe("Order Lots & Sampling Plan", () => {
  it("heads the columns as the design groups them, the tests in the template's words", () => {
    const table = sectionOf(makeSafedonExport()).lots;
    expect(table?.groups.map((group) => [group.label, group.span])).toEqual([
      ["Order", 3],
      ["Sampling Quantity", 3],
      ["Gloves per Test", 3],
      ["Packs", 1],
    ]);
    expect([table?.sizeHeader, table?.lotHeader, ...(table?.columns.map((column) => column.label) ?? [])]).toEqual([
      "Size",
      "Lot Number",
      "Cases",
      "Gloves",
      "Share",
      "Cases",
      "Plastic Packs",
      "Gloves",
      "Watertight & Visual",
      "Dimension",
      "Tensile",
      "Packaging & Dispensing",
    ]);
    // STD_EG packs inner boxes and runs force at break.
    const std = sectionOf(makeStdEgExport()).lots;
    expect(std?.groups.at(-1)?.label).toBe("Boxes");
    expect(std?.columns.map((column) => column.label)).toContain("FAB");
    expect(std?.columns.map((column) => column.label)).toContain("Inner Boxes");
  });

  it("gives each size its lots, the cases and gloves ordered with their share, what was sampled, then the totals", () => {
    const table = sectionOf(makeSafedonExport()).lots;
    const values = (size: string) => Object.fromEntries(Object.entries(table?.rows.find((row) => row.size === size)?.cells ?? {}).map(([id, cell]) => [id, cell.value]));
    expect(table?.rows.map((row) => [row.label, row.lotText])).toEqual([
      ["XS", "LOT-B01"],
      ["S", "LOT-B02"],
      ["M", "LOT-B03"],
      ["L", "LOT-B04"],
    ]);
    expect(values("S")).toEqual({
      "order.cases": 850,
      "order.gloves": 1700000,
      "order.share": 55.6,
      "sampling.cases": 20,
      "sampling.innerUnits": 25,
      "sampling.gloves": 200,
      "sampling.glovesWatertightVisual": 200,
      "sampling.glovesDimensions": 13,
      "sampling.glovesPhysical": 13,
      "sampling.innerUnitsDispensing": 8,
    });
    // The shares add up to 100, as on page 1's order mix.
    expect(table?.rows.map((row) => row.cells["order.share"].value)).toEqual([3.9, 55.6, 36.6, 3.9]);
    expect(table?.totals).toEqual({
      "order.cases": 1530,
      "order.gloves": 3060000,
      "order.share": 100,
      "sampling.cases": 45,
      "sampling.innerUnits": 60,
      "sampling.gloves": 560,
      "sampling.glovesWatertightVisual": 560,
      "sampling.glovesDimensions": 52,
      "sampling.glovesPhysical": 52,
      "sampling.innerUnitsDispensing": 26,
    });
    const widths = Object.values(table?.widths ?? {});
    expect(widths).toHaveLength(12);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 6);
  });

  it("leaves out a test row switched off on the Sampling Plan, and the gloves ordered while the gloves per case are not known", () => {
    const off = sectionOf(orderExport(FOUR_SIZES, { rowsOff: ["glovesDimensions"] })).lots;
    expect(off?.columns.map((column) => column.id)).not.toContain("sampling.glovesDimensions");
    expect(off?.groups.find((group) => group.key === "tests")?.span).toBe(2);
    const unpacked = sectionOf(orderExport(FOUR_SIZES, { packing: null })).lots;
    expect(unpacked?.columns.map((column) => column.id).slice(0, 2)).toEqual(["order.cases", "order.share"]);
  });

  it("shows the order alone without a sampling plan, and a size's missing lot and count", () => {
    const doc = orderExport({ S: { cases: 1200, lots: [] }, M: { cases: 2000, sampled: { innerUnits: null, cases: null } } });
    const table = sectionOf(doc).lots;
    expect(table?.rows[0].lotText).toBe("Not stated");
    expect(table?.rows[1].cells["sampling.cases"].value).toBeNull();
    // The totals add what is entered.
    expect(table?.totals["sampling.cases"]).toBe(35);
    const bare = structuredClone(doc);
    bare.modules = bare.modules.filter((module) => module.key !== "sampling_plan");
    expect(sectionOf(bare).lots?.columns.map((column) => column.id)).toEqual(["order.cases", "order.gloves", "order.share"]);
  });

  it("marks a count the sampling plan holds in error in fail red, and one it warns about in amber", () => {
    // More cases sampled than ordered (an error); a watertight and visual sample that is not a standard size (a warning).
    const doc = orderExport({ S: { cases: 10, sampled: { cases: 12 }, cartons: [1, 5, 10] }, M: { cases: 2000, sampled: { watertightVisual: 130 } } });
    const table = sectionOf(doc).lots;
    expect(table?.rows[0].cells["sampling.cases"]).toEqual({ value: 12, tone: "fail" });
    expect(table?.rows[1].cells["sampling.glovesWatertightVisual"]).toEqual({ value: 130, tone: "warn" });
    expect(table?.rows[1].cells["sampling.cases"].tone).toBeNull();
  });

  it("captions a test by what it counts for", () => {
    expect(testCaption("# Gloves for Dimension")).toBe("Dimension");
    expect(testCaption("# Inner Box for Packaging & Dispensing Inspection")).toBe("Packaging & Dispensing");
    expect(testCaption("# Pouches (Dye Leak Test)")).toBe("Dye Leak Test");
    expect(testCaption("FAB")).toBe("FAB");
  });
});

describe("Finished Goods Sampling (Box/Carton #)", () => {
  it("lists each size's box/carton numbers lowest first, padded as the design prints them, against the cases ordered", () => {
    const strips = sectionOf(makeStdEgExport()).cartons;
    expect(strips?.title).toBe("Finished Goods Sampling (Box/Carton #)");
    expect(strips?.legend).toBe(CARTON_LEGEND);
    const [row] = strips?.rows ?? [];
    expect(row).toMatchObject({ size: "M", label: "M", ordered: 2900, planned: 50, failing: [], overCount: false });
    expect(row.cartons).toHaveLength(50);
    expect(row.cartons).toEqual([...row.cartons].sort((a, b) => a - b));
    expect(row.numbers.slice(0, 3)).toEqual(["013", "112", "174"]);
    expect(row.numbers.at(-1)).toBe("2854");
    expect(strips?.summary).toBe("50 cartons were opened, spread from the start to the end of the lot.");
    // A lot of 60 cartons pads to two digits; its sample reaches only to 33 of 60, so the spread is not claimed.
    const safedon = sectionOf(makeSafedonExport()).cartons;
    expect(safedon?.rows[0].numbers).toEqual(["01", "12", "18", "25", "33"]);
    expect(safedon?.summary).toBe("45 cartons were opened.");
  });

  it("marks a number outside the lot or entered twice, and more numbers than the cases sampled", () => {
    const doc = orderExport({
      S: { cases: 100, sampled: { cases: 3 }, cartons: [5, 50, 120] },
      M: { cases: 200, sampled: { cases: 3 }, cartons: [10, 10, 100, 190] },
      L: { cases: 300, sampled: { cases: 2 }, cartons: [] },
    });
    const rows = sectionOf(doc).cartons?.rows ?? [];
    expect(rows[0]).toMatchObject({ failing: [120], overCount: false });
    expect(rows[1]).toMatchObject({ cartons: [10, 10, 100, 190], failing: [10], overCount: true });
    // A size with none entered keeps its strip, empty.
    expect(rows[2]).toMatchObject({ cartons: [], numbers: [], failing: [] });
  });

  it("is left out with no box/carton number entered", () => {
    expect(sectionOf(orderExport({ M: { cases: 500, cartons: [] } })).cartons).toBeNull();
  });

  it("says the cartons opened, and the spread only where every lot's sample reaches its first and last fifth", () => {
    const row = (cartons: number[], ordered: number): CartonRow => ({ size: "M", label: "M", ordered, planned: cartons.length, cartons, numbers: [], failing: [], overCount: false });
    expect(cartonSummary([row([3], 1)])).toBe("1 carton was opened, spread from the start to the end of the lot.");
    expect(cartonSummary([row([21, 80], 100), row([1, 100], 100)])).toBe("4 cartons were opened.");
    expect(cartonSummary([row([20, 81], 100), row([1, 100], 100)])).toBe("4 cartons were opened, spread from the start to the end of each lot.");
    expect(cartonSummary([row([1, 100], 100), row([], 100)])).toBe("2 cartons were opened.");
  });

  it("pads a number to the lot's digits, at most three", () => {
    expect([paddedCarton(7, 60), paddedCarton(15, 1120), paddedCarton(1097, 1120), paddedCarton(5, 9), paddedCarton(42, 250)]).toEqual(["07", "015", "1097", "5", "042"]);
  });
});

describe("the blocks switched on", () => {
  it("leaves out a block switched off, and prints the rest", () => {
    const doc = withBlocks(makeStdEgExport(), { gloveInformation: false, finishedGoodsSampling: false });
    const content = sectionOf(doc);
    expect(content).toMatchObject({ glove: null, cartons: null });
    expect(content.packing).not.toBeNull();
    expect(content.pages).toEqual([{ parts: [{ kind: "cards" }, { kind: "lots" }] }]);
  });

  it("builds nothing when none of its blocks holds anything", () => {
    const doc = makeStdEgExport();
    const entry = entryOf(doc);
    for (const key of ["glove_info", "packing_config", "order_lots", "carton_sampling"]) Object.assign(moduleIn(doc, key), { data: {}, computed: {} });
    moduleIn(doc, "header").data = { ...moduleIn(doc, "header").data, factoryGloveCode: null };
    expect(orderSampling.build(doc, entry)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The pages
 * ------------------------------------------------------------------ */

const A4 = { width: 210, height: 297 };

/** Strips of `lines` lines each: 20 three-digit numbers fill a line of the A4 track. */
function strips(lines: readonly number[]): CartonStrips {
  return {
    title: "Finished Goods Sampling (Box/Carton #)",
    summary: "40 cartons were opened.",
    legend: CARTON_LEGEND,
    rows: lines.map((count, index) => {
      const numbers = Array.from({ length: count * 20 }, (_, n) => String(100 + n));
      return { size: `S${index}`, label: `S${index}`, ordered: 999, planned: numbers.length, cartons: numbers.map(Number), numbers, failing: [], overCount: false };
    }),
  };
}

/** A details card two rows tall when alone (three columns). */
const GLOVE: GloveCard = {
  title: "Glove Information",
  facts: ["surfaceTexture", "colour", "indicativeWeight", "length", "gloveType", "factoryGloveCode"].map((key) => ({
    key: key as GloveCard["facts"][number]["key"],
    label: "Label",
    value: "Value",
    stated: true,
    swatch: null,
  })),
};

const blocks = (cartons: CartonStrips | null, glove: GloveCard | null = GLOVE) => ({ lead: "A lead.", glove, packing: null, lots: null, cartons });

describe("the pages", () => {
  it("measures text in Outfit: tabular figures 0.59 em, lines broken at spaces as the browser breaks them", () => {
    expect(textWidth("000", { pt: 10, tabular: true })).toBeCloseTo(3 * 0.59 * 10 * (25.4 / 72), 6);
    expect(textWidth("Total", { pt: 9, bold: true })).toBeGreaterThan(textWidth("Total", { pt: 9 }));
    const style = { pt: 9, tabular: true, wordSpacing: 0.6 };
    const twenty = Array.from({ length: 20 }, () => "123");
    const track = trackWidth(A4.width - ORDER_SAMPLING_ROOM.margins);
    expect(lineStarts(twenty, track, style)).toEqual([0]);
    expect(lineStarts([...twenty, "123"], track, style)).toEqual([0, 20]);
    // A word wider than the line breaks anywhere and fills the lines it needs.
    expect(wrappedLines("W".repeat(40), 20, { pt: 10 })).toBe(Math.ceil(textWidth("W".repeat(40), { pt: 10 }) / 20));
    expect(twoLineWidth("Watertight & Visual", { pt: 8.5 })).toBeCloseTo(textWidth("Watertight", { pt: 8.5 }), 6);
    // "&" stays with the word after it: two lines at the narrowest, never "&" alone (Kenneth's screen, 27 October 2026).
    expect(wrappedLines("Packaging & Dispensing", textWidth("& Dispensing", { pt: 8.5 }), { pt: 8.5 })).toBe(2);
    expect(captionText("Packaging & Dispensing")).toBe("Packaging &\u00a0Dispensing");
  });

  it("keeps the example reports to one page, the five sizes of a large order to two, the strips breaking two and three", () => {
    expect(sectionOf(makeSafedonExport()).pages).toHaveLength(1);
    const five = orderExport({
      XS: { cases: 900, sampled: { cases: 30 } },
      S: { cases: 2400, sampled: { cases: 49 } },
      M: { cases: 3100, sampled: { cases: 56 } },
      L: { cases: 2600, sampled: { cases: 51 } },
      XL: { cases: 700, sampled: { cases: 27 } },
    });
    const content = sectionOf(five);
    expect(content.pageCount).toBe(2);
    expect(content.pages.map((page) => page.parts.map((part) => (part.kind === "cartons" ? `cartons ${part.continued ? "continued " : ""}${part.slices.map((slice) => content.cartons?.rows[slice.row].size).join(" ")}` : part.kind)))).toEqual([
      ["cards", "lots", "cartons XS S"],
      ["cartons continued M L XL"],
    ]);
    // The plan numbers the pages after it from there.
    const model = buildReportModel(five);
    expect(model.plan.find((entry) => entry.key === "orderSampling")?.pageCount).toBe(2);
  });

  it("puts a block that does not fit on the next page, keeping at least two strips either side of a break", () => {
    // Seven lines a strip: three fit under the card, four make 2 and 2.
    expect(layoutOrderSampling(blocks(strips([7, 7, 7, 7])), A4).map((page) => page.parts)).toEqual([
      [{ kind: "cards" }, { kind: "cartons", continued: false, slices: [0, 1].map((row) => ({ row, from: 0, to: 140, continued: false })) }],
      [{ kind: "cartons", continued: true, slices: [2, 3].map((row) => ({ row, from: 0, to: 140, continued: false })) }],
    ]);
    // Three strips of which two fit go on together.
    expect(layoutOrderSampling(blocks(strips([9, 9, 9])), A4).map((page) => page.parts.map((part) => part.kind))).toEqual([["cards"], ["cartons"]]);
    // With nothing above them, as many as fit stay.
    expect(layoutOrderSampling(blocks(strips([9, 9, 9, 9, 9]), null), A4)[0].parts).toEqual([
      { kind: "cartons", continued: false, slices: [0, 1, 2].map((row) => ({ row, from: 0, to: 180, continued: false })) },
    ]);
  });

  it("leaves room for a footer note, and for Letter's shorter page", () => {
    // Under the heading, its lead and the strips' heading and summary: room for 39 lines of numbers on A4, not 40.
    const R = ORDER_SAMPLING_ROOM;
    const free = A4.height - R.chrome - R.slack - (R.heading.height + R.heading.leadGap + R.heading.leadLine) - R.gap - (5.3 + 2 + 5.03 + 3);
    expect(stripHeight(39)).toBeLessThanOrEqual(free);
    expect(stripHeight(40)).toBeGreaterThan(free);
    expect(layoutOrderSampling(blocks(strips([39]), null), A4)).toHaveLength(1);
    expect(layoutOrderSampling(blocks(strips([40]), null), A4)).toHaveLength(2);
    expect(layoutOrderSampling(blocks(strips([39]), null), A4, { footerNote: true })).toHaveLength(2);
    expect(layoutOrderSampling(blocks(strips([39]), null), { width: 215.9, height: 279.4 })).toHaveLength(2);
  });

  it("breaks a size's numbers between lines only where its strip, alone on a page, would still not fit", () => {
    const pages = layoutOrderSampling(blocks(strips([50]), null), A4);
    const slices = pages.flatMap((page) => page.parts.flatMap((part) => (part.kind === "cartons" ? part.slices : [])));
    // 39 lines on the first page, the other 11 on the next.
    expect(slices.map((slice) => [slice.from, slice.to, slice.continued])).toEqual([
      [0, 780, false],
      [780, 1000, true],
    ]);
    expect(pages).toHaveLength(2);
  });

  it("spreads the box/carton numbers the example generates over the whole lot", () => {
    const cartons = spreadCartons(30, 2000, 3);
    expect(new Set(cartons).size).toBe(30);
    expect(Math.min(...cartons)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...cartons)).toBeLessThanOrEqual(2000);
  });
});
