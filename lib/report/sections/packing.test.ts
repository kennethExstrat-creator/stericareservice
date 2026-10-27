// Section 07, Glove Packing & Dispensing (TG35 page 7), from the export: the
// lead from the config, the chart's rows, the per-box table, the aged
// gloves, the grades and the pages they are planned on. From the placeholder
// example reports (STD_EG: size M, 13 boxes; SAFEDON_EG: no packing check)
// and the STD_EG export made over for one to five sizes, the module's own
// calc working out what the export carries.
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { fourSizeExport, packingBoxes, packingExport, type PackingSizeInput } from "../__fixtures__/packing-export";
import { buildReportModel, type PackingSection, type ReportSectionPlanEntry } from "../model";
import { lineCount, MIN_ROWS, PACKING_ROOM, perBoxGeometry, planPages, textWidth } from "./packing";

function packingOf(doc: InspectionExport): { entry: ReportSectionPlanEntry | undefined; content: PackingSection | undefined } {
  const model = buildReportModel(doc);
  const entry = model.plan.find((item): item is ReportSectionPlanEntry => item.kind === "section" && item.key === "packing");
  const content = model.sections.packing;
  // The packing check's content; a Safedon template's Glove Dispensing has tests of its own (glove-dispensing.test.ts).
  return { entry, content: content?.kind === "safedon" ? undefined : content };
}

function contentOf(doc: InspectionExport): PackingSection {
  const { content } = packingOf(doc);
  if (!content) throw new Error("The packing section was not built.");
  return content;
}

/** The note as one line of text, failing parts in [brackets]. */
const noteText = (content: PackingSection) => content.perBox?.note.map((part) => (part.fail ? `[${part.text}]` : part.text)).join("");

const DEFAULT_LEAD =
  "Inner boxes opened to check glove layering and how cleanly gloves dispense. Minimum 70% layering and 80% dispensing; stickiness grades A to C pass, D fails.";

describe("which inspections it builds for", () => {
  it("builds from the packing check, and hands an inspection without one to Glove Dispensing (SAFEDON_EG's Safedon dispensing)", () => {
    expect(packingOf(makeStdEgExport()).entry).toMatchObject({ kicker: "Section 07", title: "Glove Packing & Dispensing", built: true, pageCount: 1 });
    const safedon = buildReportModel(makeSafedonExport());
    expect(safedon.plan.find((item) => item.key === "packing")).toMatchObject({ title: "Glove Dispensing", built: true });
    expect(safedon.sections.packing?.kind).toBe("safedon");
  });

  it("builds only the blocks switched on, in the plan's order", () => {
    const doc = makeStdEgExport();
    const only = (blocks: Record<string, boolean>) =>
      contentOf(withReportOptions(doc, { sections: { ...doc.report.sections, packing: { include: true, blocks } } }));
    const grades = only({ averageLayeringDispensing: false, perBoxResults: false, agedGloves: false, stickinessGrades: true });
    expect(grades).toMatchObject({ chart: null, perBox: null, aged: null });
    expect(grades.grades?.map((grade) => grade.code)).toEqual(["A", "B", "B1", "C", "D"]);
    expect(grades.pages).toEqual([{ parts: [{ kind: "agedAndGrades" }] }]);
    const boxes = only({ averageLayeringDispensing: false, perBoxResults: true, agedGloves: true, stickinessGrades: false });
    expect(boxes).toMatchObject({ chart: null, grades: null });
    expect(boxes.aged?.rows.map((row) => [row.label, row.status])).toEqual([["M", "pass"]]);
    expect(boxes.pages).toEqual([{ parts: [{ kind: "perBox", from: 0, to: 13 }, { kind: "agedAndGrades" }] }]);
    // The aged gloves alone, with no aged sample entered: each size on the order, Not Done (Kenneth, 27 October 2026).
    const agedOnly = { averageLayeringDispensing: false, perBoxResults: false, agedGloves: true, stickinessGrades: false };
    const none = packingExport({ M: { boxes: packingBoxes(13) } });
    const missing = contentOf(withReportOptions(none, { sections: { ...none.report.sections, packing: { include: true, blocks: agedOnly } } }));
    expect(missing.aged?.rows.map((row) => [row.label, row.layering.value, row.dispensing.value, row.grade, row.status])).toEqual([
      ["M", null, null, null, "not_done"],
    ]);
    expect(missing.pages).toEqual([{ parts: [{ kind: "agedAndGrades" }] }]);
    // With no size on the order: nothing to show, so "nothing entered yet".
    const order = doc.modules.find((module) => module.key === "order_lots");
    if (order) order.data = { ...order.data, sizes: {} };
    const nothing = withReportOptions(doc, { sections: { ...doc.report.sections, packing: { include: true, blocks: agedOnly } } });
    expect(packingOf(nothing).entry).toMatchObject({ built: false });
  });
});

describe("the STD_EG example: size M, 13 boxes, and the placeholder aged sample (the report printed none)", () => {
  const content = contentOf(makeStdEgExport());

  it("leads with what was checked, the template's minimums and which grades pass", () => {
    expect(content.lead).toBe(DEFAULT_LEAD);
    expect(content.minimums).toEqual({ layering: 70, dispensing: 80 });
    expect(content.words).toEqual({
      layering: "Layering",
      dispensing: "Dispensing",
      stickiness: "Stickiness",
      layeringShort: "Layer",
      dispensingShort: "Disp.",
      boxNo: "Box/Carton #",
      item: "Item",
      average: "Average",
    });
  });

  it("charts the size's averages from the module's calc and its worst grade, and its aged sample under them", () => {
    expect(content.chart?.rows).toEqual([
      {
        key: "M",
        label: "M",
        sublabel: "13 boxes",
        layering: { value: expect.closeTo(88.31, 2), low: false },
        dispensing: { value: expect.closeTo(90.31, 2), low: false },
        grade: { code: "A", label: "Non sticky", pass: true },
      },
    ]);
    expect(content.chart?.aged).toEqual({
      key: "aged",
      label: "Aged Gloves",
      sublabel: "70 °C · 7 days · 1 box",
      layering: { value: 85, low: false },
      dispensing: { value: 88, low: false },
      grade: { code: "A", label: "Non sticky", pass: true },
    });
  });

  it("tables the aged sample with its result", () => {
    expect(content.aged?.title).toBe("Box-Aged Gloves (70 °C, 7 Days)");
    expect(content.aged?.rows.map((row) => [row.label, row.layering.value, row.dispensing.value, row.grade?.code, row.status])).toEqual([
      ["M", 85, 88, "A", "pass"],
    ]);
    expect(content.aged?.status).toBe("pass");
  });

  it("lists every box by item, and says every box was graded A", () => {
    const perBox = content.perBox;
    expect(perBox?.items).toBe(13);
    expect(perBox?.sizes.map((size) => size.size)).toEqual(["M"]);
    expect(perBox?.sizes[0].boxes[0]).toEqual({ boxNo: 13, layering: { value: 90, low: false }, dispensing: { value: 92, low: false } });
    // Box 2336 is in no carton list: a warning on its cell, printed as typed.
    expect(perBox?.sizes[0].boxes[11]?.boxNo).toBe(2336);
    expect(noteText(content)).toBe("Layering and dispensing in %. Every box graded stickiness A.");
  });

  it("gives the template's stickiness codes with their legends, D failing", () => {
    expect(content.grades).toEqual([
      { code: "A", label: "Non sticky", pass: true },
      { code: "B", label: "A mix of non sticky to lightly sticky", pass: true },
      { code: "B1", label: "A mix of non sticky to light stickiness at the bead", pass: true },
      { code: "C", label: "Lightly sticky but dispensable", pass: true },
      { code: "D", label: "Too sticky & affect dispensing", pass: false },
    ]);
  });

  it("prints on one page", () => {
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 13 }, { kind: "agedAndGrades" }] }]);
    expect(content.pageCount).toBe(1);
  });
});

describe("four sizes with an aged sample each, as TG35 page 7", () => {
  const content = contentOf(fourSizeExport());

  it("charts each size's boxes and averages, and the aged gloves under them", () => {
    expect(content.chart?.rows.map((row) => [row.label, row.sublabel, row.layering.value, row.dispensing.value, row.grade?.code])).toEqual([
      ["S", "8 boxes", 90, 92, "A"],
      ["M", "13 boxes", 90, 92, "A"],
      ["L", "8 boxes", 88, 90, "A"],
      ["XL", "5 boxes", 87, 89, "A"],
    ]);
    // The aged samples' ageing (TG35's 70 °C for 7 days), their count, averages and worst grade (B1 comes after B among the codes).
    expect(content.chart?.aged).toEqual({
      key: "aged",
      label: "Aged Gloves",
      sublabel: "70 °C · 7 days · 4 boxes",
      layering: { value: 88.5, low: false },
      dispensing: { value: 86.5, low: false },
      grade: { code: "B1", label: "A mix of non sticky to light stickiness at the bead", pass: true },
    });
  });

  it("lists the boxes by item, the sizes side by side, the shorter sizes' rows left blank", () => {
    const perBox = content.perBox;
    expect(perBox?.items).toBe(13);
    expect(perBox?.sizes.map((size) => [size.size, size.boxes.length, size.layering.value, size.dispensing.value])).toEqual([
      ["S", 8, 90, 92],
      ["M", 13, 90, 92],
      ["L", 8, 88, 90],
      ["XL", 5, 87, 89],
    ]);
    expect(perBox?.sizes[3].boxes[4]?.boxNo).toBe(6029);
    expect(perBox?.sizes[3].boxes[5]).toBeUndefined();
  });

  it("tables the aged samples with one result for all of them, their average and worst grade", () => {
    expect(content.aged?.title).toBe("Box-Aged Gloves (70 °C, 7 Days)");
    expect(content.aged?.rows.map((row) => [row.label, row.layering.value, row.dispensing.value, row.grade?.code, row.status])).toEqual([
      ["S", 87, 85, "B", "pass"],
      ["M", 91, 89, "B", "pass"],
      ["L", 89, 87, "B1", "pass"],
      ["XL", 87, 85, "B", "pass"],
    ]);
    expect(content.aged?.average).toMatchObject({ layering: { value: 88.5 }, dispensing: { value: 86.5 }, grade: { code: "B1" } });
    expect(content.aged?.status).toBe("pass");
  });

  it("fits on one A4 page as the design does; on Letter, or under a footer note, the last blocks move to a second", () => {
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 13 }, { kind: "agedAndGrades" }] }]);
    const letter = contentOf(withReportOptions(fourSizeExport(), { pageSize: "letter" }));
    expect(letter.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 13 }] }, { parts: [{ kind: "agedAndGrades" }] }]);
    const noted = packingOf(withReportOptions(fourSizeExport(), { footerNote: "For the buyer's quality team only." }));
    expect(noted.content?.pages).toHaveLength(2);
    expect(noted.entry?.pageCount).toBe(2);
  });
});

describe("the template's words and settings", () => {
  it("uses the template's labels in the words, the lead and the note", () => {
    const content = contentOf(
      fourSizeExport({
        labels: { layeringPct: "Layer Rate %", dispensingPct: "Dispense %", stickiness: "Tackiness **", itemColumn: "No.", boxNo: "Box #", layeringAverage: "Mean" },
      }),
    );
    expect(content.words).toEqual({
      layering: "Layer Rate",
      dispensing: "Dispense",
      stickiness: "Tackiness",
      layeringShort: "Layer Rate",
      dispensingShort: "Dispense",
      boxNo: "Box #",
      item: "No.",
      average: "Mean",
    });
    expect(content.lead).toBe(
      "Inner boxes opened to check glove layer Rate and how cleanly gloves dispense. Minimum 70% layer Rate and 80% dispense; tackiness grades A to C pass, D fails.",
    );
    expect(noteText(content)).toBe("Layer Rate and dispense in %. Every box graded tackiness A.");
  });

  it("states the template's minimums and its grades as runs or lists, and the packing's inner unit", () => {
    const codes = (passes: boolean[]) => passes.map((pass, index) => ({ code: "ABCD"[index], label: `Grade ${"ABCD"[index]}`, pass }));
    const lead = (config: object, unit?: string) => {
      const doc = packingExport({ M: { boxes: packingBoxes(3) } }, { config });
      if (unit) {
        const packing = doc.modules.find((module) => module.key === "packing_config");
        if (packing) packing.computed = { ...packing.computed, innerUnit: unit };
      }
      return contentOf(doc).lead;
    };
    expect(lead({ minLayeringPct: 75, minDispensingPct: 82.5, stickinessCodes: codes([true, true, false, false]) })).toBe(
      "Inner boxes opened to check glove layering and how cleanly gloves dispense. Minimum 75% layering and 82.5% dispensing; stickiness grades A and B pass, C and D fail.",
    );
    expect(lead({ stickinessCodes: codes([true, false, false, false]) })).toContain("; stickiness grade A passes, B to D fail.");
    expect(lead({ stickinessCodes: codes([true, true, true, true]) })).toContain("; stickiness grades A to D pass.");
    expect(lead({ stickinessCodes: codes([true, false, true, false]) })).toContain("; stickiness grades A and C pass, B and D fail.");
    expect(lead({}, "pouch")).toMatch(/^Pouches opened to check glove layering/);
    expect(lead({}, "dispenser box")).toMatch(/^Dispenser boxes opened/);
  });
});

describe("failing values and grades", () => {
  const failing = (): InspectionExport =>
    packingExport({
      S: { boxes: packingBoxes(4, { layeringPct: 60, dispensingPct: 75 }), aged: { layeringPct: 72, dispensingPct: 81, stickiness: "A" } },
      M: {
        boxes: [...packingBoxes(3), { boxNo: 7900, layeringPct: 88, dispensingPct: 90, stickiness: "D" }],
        aged: { layeringPct: 65, dispensingPct: 79.9, stickiness: "D" },
      },
    });
  const content = contentOf(failing());

  it("marks an average and a box below their minimums, and a size's worst grade where it fails", () => {
    const [s, m] = content.chart?.rows ?? [];
    expect([s.layering, s.dispensing]).toEqual([
      { value: 60, low: true },
      { value: 75, low: true },
    ]);
    expect(m.grade).toEqual({ code: "D", label: "Too sticky & affect dispensing", pass: false });
    expect(content.perBox?.sizes[0].boxes[0]).toMatchObject({ layering: { value: 60, low: true }, dispensing: { value: 75, low: true } });
    expect(content.perBox?.sizes[0].layering).toEqual({ value: 60, low: true });
  });

  it("lists the grades given when they differ, a failing grade's part apart", () => {
    expect(noteText(content)).toBe("Layering and dispensing in %. Stickiness grades: 7 boxes A and [1 box D].");
  });

  it("gives each aged sample its own result when they differ, and flags the failing values", () => {
    const aged = content.aged;
    expect(aged?.status).toBeNull();
    expect(aged?.rows.map((row) => [row.label, row.status, row.layering.low, row.dispensing.low, row.grade?.pass])).toEqual([
      ["S", "pass", false, false, true],
      ["M", "fail", true, true, false],
    ]);
    expect(aged?.average).toMatchObject({ layering: { value: 68.5, low: true }, dispensing: { value: 80.45, low: false }, grade: { code: "D", pass: false } });
    expect(content.chart?.aged?.grade?.pass).toBe(false);
  });

  it("judges a figure at one decimal against its minimum, as the module does", () => {
    const at = (layeringPct: number) => contentOf(packingExport({ M: { boxes: packingBoxes(1, { layeringPct }) } })).chart?.rows[0].layering;
    expect(at(70)).toEqual({ value: 70, low: false });
    expect(at(69.96)).toEqual({ value: 69.96, low: false });
    expect(at(69.94)).toEqual({ value: 69.94, low: true });
  });
});

describe("missing data", () => {
  it("draws a size ordered with nothing entered, keeps a blank row's item and drops the blank rows after the last box", () => {
    const content = contentOf(
      packingExport({
        S: { boxes: [] },
        M: { boxes: [{ boxNo: 7005, layeringPct: 90, dispensingPct: 92, stickiness: "A" }, {}, { boxNo: 7009, layeringPct: 88 }, {}, {}] },
      }),
    );
    expect(content.chart?.rows.map((row) => [row.label, row.sublabel, row.layering.value, row.dispensing.value, row.grade?.code ?? null])).toEqual([
      ["S", "0 boxes", null, null, null],
      ["M", "2 boxes", 89, 92, "A"],
    ]);
    expect(content.perBox?.items).toBe(3);
    expect(content.perBox?.sizes[1].boxes).toEqual([
      { boxNo: 7005, layering: { value: 90, low: false }, dispensing: { value: 92, low: false } },
      null,
      { boxNo: 7009, layering: { value: 88, low: false }, dispensing: { value: null, low: false } },
    ]);
    expect(noteText(content)).toBe("Layering and dispensing in %. Stickiness grades: 1 box A and 1 box not graded yet.");
    expect(content.chart?.aged).toBeNull();
  });

  it("lists every size on the order in the aged gloves' table, one with no aged sample entered blank and Not Done (Kenneth, 27 October 2026)", () => {
    const content = contentOf(
      packingExport({
        S: { boxes: packingBoxes(8), aged: { layeringPct: 87, dispensingPct: 85, stickiness: "B" } },
        M: { boxes: packingBoxes(13, {}, 8001) },
      }),
    );
    expect(content.aged?.rows.map((row) => [row.label, row.layering.value, row.dispensing.value, row.grade?.code ?? null, row.status])).toEqual([
      ["S", 87, 85, "B", "pass"],
      ["M", null, null, null, "not_done"],
    ]);
    // The rows differ, so each prints its own; the average and the chart's row are the samples entered.
    expect(content.aged?.status).toBeNull();
    expect(content.aged?.average).toMatchObject({ layering: { value: 87 }, dispensing: { value: 85 }, grade: { code: "B" } });
    expect(content.chart?.aged).toMatchObject({ sublabel: "70 °C · 7 days · 1 box", layering: { value: 87 }, dispensing: { value: 85 } });
    // None entered: each size Not Done, once across the rows; nothing to chart.
    const none = contentOf(packingExport({ S: { boxes: packingBoxes(8) }, M: { boxes: packingBoxes(13, {}, 8001) } }));
    expect(none.aged?.rows.map((row) => [row.label, row.status])).toEqual([
      ["S", "not_done"],
      ["M", "not_done"],
    ]);
    expect(none.aged?.status).toBe("not_done");
    expect(none.aged?.average).toEqual({ layering: { value: null, low: false }, dispensing: { value: null, low: false }, grade: null });
    expect(none.chart?.aged).toBeNull();
  });

  it("says when no box is entered or graded yet", () => {
    const empty = contentOf(packingExport({ M: { boxes: [] } }));
    expect(empty.perBox?.items).toBe(0);
    expect(noteText(empty)).toBe("Layering and dispensing in %.");
    expect(empty.pages[0].parts).toContainEqual({ kind: "perBox", from: 0, to: 0 });
    const ungraded = contentOf(packingExport({ M: { boxes: packingBoxes(2, { stickiness: null }) } }));
    expect(noteText(ungraded)).toBe("Layering and dispensing in %. No box graded for stickiness yet.");
  });

  it("with nothing ordered, prints the grades alone", () => {
    const doc = makeStdEgExport();
    const order = doc.modules.find((module) => module.key === "order_lots");
    if (order) order.data = { ...order.data, sizes: {} };
    const content = contentOf(doc);
    expect(content).toMatchObject({ chart: null, perBox: null, aged: null });
    expect(content.pages).toEqual([{ parts: [{ kind: "agedAndGrades" }] }]);
  });

  it("states the ageing as TG35 does, 70 °C for 7 days, whatever the samples' notes say", () => {
    const aged = (notes: (string | null)[]) => {
      const sizes = Object.fromEntries(
        ["S", "M", "L"].map((size, index): [string, PackingSizeInput] => [
          size,
          { boxes: packingBoxes(2), aged: { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: notes[index] } },
        ]),
      );
      const content = contentOf(packingExport(sizes));
      return [content.chart?.aged?.sublabel, content.aged?.title];
    };
    const stated = ["70 °C · 7 days · 3 boxes", "Box-Aged Gloves (70 °C, 7 Days)"];
    expect(aged(["70 °C, 7 days", "70 °C, 7 days", "70 °C, 7 days"])).toEqual(stated);
    expect(aged(["Aged sample", "Aged sample", "aged sample."])).toEqual(stated);
    expect(aged(["70 °C, 7 days", "70 °C, 3 days", null])).toEqual(stated);
    expect(aged([null, null, null])).toEqual(stated);
  });
});

describe("the pages", () => {
  const many = (sizes: string[], boxes: number) =>
    packingExport(
      Object.fromEntries(
        sizes.map((size, index): [string, PackingSizeInput] => [size, { boxes: packingBoxes(boxes, {}, 10000 + 1000 * index), aged: { layeringPct: 88, dispensingPct: 86, stickiness: "B" } }]),
      ),
    );

  it("runs the per-box table on to more pages when the boxes do not fit, every item once, the average with the last", () => {
    const { entry, content } = packingOf(many(["XS", "S", "M", "L", "XL"], 50));
    const pages = content?.pages ?? [];
    expect(pages.length).toBeGreaterThan(1);
    expect(entry?.pageCount).toBe(pages.length);
    expect(pages[0].parts[0]).toEqual({ kind: "chart" });
    const chunks = pages.flatMap((page) => page.parts).filter((part) => part.kind === "perBox");
    expect(chunks[0]).toMatchObject({ from: 0 });
    chunks.slice(1).forEach((chunk, index) => expect(chunk.from).toBe(chunks[index].to));
    expect(chunks.at(-1)?.to).toBe(50);
    expect(pages.at(-1)?.parts.at(-1)).toEqual({ kind: "agedAndGrades" });
    // Each later page holds no more than a page's room: about 40 rows of boxes.
    for (const chunk of chunks) expect(chunk.to - chunk.from).toBeLessThanOrEqual(42);
  });

  it("starts the table on the next page rather than leave a few rows under the chart, and moves a block that does not fit whole", () => {
    const body = contentOf(many(["S", "M"], 20));
    const plan = (room: number) => planPages(body, { room, width: 184 });
    // The least room in which the table starts under the chart: it starts with MIN_ROWS rows, never fewer.
    let room = 60;
    while (!plan(room)[0].parts.some((part) => part.kind === "perBox")) room += 0.25;
    expect(plan(room)[0].parts).toEqual([{ kind: "chart" }, { kind: "perBox", from: 0, to: MIN_ROWS }]);
    expect(plan(room - 0.25)[0].parts).toEqual([{ kind: "chart" }]);
    expect(plan(room - 0.25)[1].parts[0]).toMatchObject({ kind: "perBox", from: 0 });
    expect(plan(room).at(-1)?.parts.at(-1)).toEqual({ kind: "agedAndGrades" });
    // A page too small for anything: each part still prints, a page each.
    const none = planPages(body, { room: 10, width: 184 });
    expect(none.map((page) => page.parts)).toEqual([[{ kind: "chart" }], [{ kind: "perBox", from: 0, to: 20 }], [{ kind: "agedAndGrades" }]]);
  });

  it("never leaves a lone row to go on with the average: a short rest moves whole, a long one leaves MIN_ROWS", () => {
    const body = contentOf(many(["S", "M"], 20));
    const plan = (room: number) => planPages(body, { room, width: 184 }).flatMap((page) => page.parts.filter((part) => part.kind === "perBox"));
    for (let room = 120; room <= 200; room += 0.5) {
      const chunks = plan(room);
      for (const chunk of chunks.slice(1)) expect(chunk.kind === "perBox" && 20 - chunk.from).toBeGreaterThanOrEqual(MIN_ROWS);
      expect(chunks.at(-1)).toMatchObject({ to: 20 });
    }
  });

  it("lays out one or two sizes at their own width and three or more across the page", () => {
    expect(perBoxGeometry(1, 184)).toEqual({ table: 60, item: 14, box: expect.closeTo(21.16, 2), layering: expect.closeTo(12.42, 2), dispensing: expect.closeTo(12.42, 2) });
    expect(perBoxGeometry(2, 184).table).toBe(106);
    expect(perBoxGeometry(3, 184).table).toBe(184);
    expect(perBoxGeometry(4, 184)).toMatchObject({ table: 184, item: 14 });
    expect(perBoxGeometry(5, 184)).toMatchObject({ table: 184, item: 10 });
  });

  it("estimates text by Outfit's widths, a little long: the box/carton heading in two lines, a grade's legend in one", () => {
    // The design's per-box heading: "Box/Carton" then "#", in a column 46% of a size's 42.5 mm.
    expect(lineCount("Box/Carton #", 42.5 * 0.46 - PACKING_ROOM.cellPadding, 8.5)).toBe(2);
    expect(lineCount("Layer", 42.5 * 0.27 - PACKING_ROOM.cellPadding, 8.5)).toBe(1);
    expect(lineCount("A mix of non sticky to lightly sticky. Passed.", 78, 8.5)).toBe(1);
    expect(lineCount(DEFAULT_LEAD, 175, 9.5)).toBe(2);
    expect(textWidth("Average Layering & Dispensing", 12)).toBeGreaterThan(60);
    expect(textWidth("Average Layering & Dispensing", 12)).toBeLessThan(68);
  });
});
