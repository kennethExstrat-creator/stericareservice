// Section 07 for a Safedon template, Glove Dispensing, from the export: the
// lead, the defect rate chart against the maximum, the per-box table, the
// defects by type and their definitions, and the pages they are planned on.
// From the placeholder SAFEDON_EG example (sizes XS to L) and SAFEDON_EG made
// over for one to five sizes (lib/report/__fixtures__/glove-dispensing-export.ts),
// the module's own calc working out what the export carries.
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { dispensingBoxes, dispensingExport, type DispensingBoxInput } from "../__fixtures__/glove-dispensing-export";
import { buildReportModel, type GloveDispensingSection, type ReportSectionPlanEntry } from "../model";
import { dispensingBoxGeometry, MIN_BOX_ROWS, planGloveDispensing, type DispensingDefectRow } from "./glove-dispensing";

function sectionOf(doc: InspectionExport): { entry: ReportSectionPlanEntry | undefined; content: GloveDispensingSection | undefined } {
  const model = buildReportModel(doc);
  const entry = model.plan.find((item): item is ReportSectionPlanEntry => item.kind === "section" && item.key === "packing");
  const content = model.sections.packing;
  return { entry, content: content?.kind === "safedon" ? content : undefined };
}

function contentOf(doc: InspectionExport): GloveDispensingSection {
  const { content } = sectionOf(doc);
  if (!content) throw new Error("Glove Dispensing was not built.");
  return content;
}

/** A row of the defects table as its label and its figures, the result row's verdicts. */
const rowOf = (row: DispensingDefectRow) => [row.label, ...(row.statuses ?? row.values.map((value) => value.text))];
const tonesOf = (row: DispensingDefectRow | undefined) => row?.values.map((value) => value.tone);
const rowIn = (content: GloveDispensingSection, kind: DispensingDefectRow["kind"]) => content.defects.rows.find((row) => row.kind === kind);

/** Thirteen boxes numbered from `first` (placeholders), with defects in the boxes given by index. */
function thirteen(first: number, defects: Record<number, Record<string, number>> = {}): DispensingBoxInput[] {
  return dispensingBoxes(13, first).map((box, index) => ({ ...box, counts: defects[index] ?? {} }));
}

/** Section 07's blocks switched as given. */
function switched(doc: InspectionExport, blocks: Record<string, boolean>): InspectionExport {
  return withReportOptions(doc, { sections: { ...doc.report.sections, packing: { include: true, blocks } } });
}

/** Size M failing (40 defects in 625 gloves), L and XS not done (XS with a box counted but not numbered), a box/carton number S did not sample. */
const failing = (): InspectionExport =>
  dispensingExport({
    XS: { boxes: [{ boxNo: 8001, counts: { no_cuff: 1 } }, { boxNo: null, counts: { sticky: 2 } }, { boxNo: 8015 }], planned: 3 },
    S: { boxes: dispensingBoxes(5, 8101), sampled: [8101, 8108, 8115, 8122] },
    M: { boxes: dispensingBoxes(5, 8201, { sticky: 6, multiple_out: 2 }) },
    L: { boxes: dispensingBoxes(3, 8301, { finger_out: 1 }), planned: 5 },
  });

const LEAD =
  "Gloves dispensed from 26 plastic packs of 125 and checked for 6 dispensing defects (sampling code letters C and D). A size passes at a defect rate of 5% or less; every size passed.";

describe("which inspections it builds for", () => {
  it("builds Section 07 from the Safedon dispensing check where there is no packing check, titled Glove Dispensing", () => {
    const { entry, content } = sectionOf(makeSafedonExport());
    expect(entry).toMatchObject({ kicker: "Section 07", title: "Glove Dispensing", moduleKeys: ["dispensing_safedon"], built: true, pageCount: 1 });
    expect(content?.kind).toBe("safedon");
  });

  it("leaves the packing check's section to it where a template has both", () => {
    const doc = makeStdEgExport();
    const safedon = makeSafedonExport().modules.find((module) => module.key === "dispensing_safedon");
    if (!safedon) throw new Error("SAFEDON_EG has no Safedon dispensing check.");
    doc.modules = [...doc.modules, safedon];
    const model = buildReportModel(doc);
    expect(model.plan.find((item) => item.key === "packing")).toMatchObject({ built: true, moduleKeys: ["dispensing_packing", "dispensing_safedon"] });
    expect(model.sections.packing?.kind).toBeUndefined();
  });

  it("prints 'coming next' with no size on the order", () => {
    const doc = makeSafedonExport();
    const order = doc.modules.find((module) => module.key === "order_lots");
    if (order) order.data = { ...order.data, sizes: {} };
    expect(sectionOf(doc)).toMatchObject({ entry: { built: false }, content: undefined });
  });
});

describe("the SAFEDON_EG example: sizes XS to L, every size passed", () => {
  const content = contentOf(makeSafedonExport());

  it("leads with what was dispensed and checked for, the code letters, the template's maximum and how the sizes did", () => {
    expect(content.lead).toBe(LEAD);
    expect(content.sizes.map((size) => size.label)).toEqual(["XS", "S", "M", "L"]);
    expect(content.words).toEqual({ no: "No.", boxNo: "Box/Carton #", defects: "Defects", total: "Total" });
  });

  it("charts each size's defect rate, the module's own, against the 5% maximum, with the figures and the size's result", () => {
    const chart = content.chart;
    expect(chart).toMatchObject({ title: "Defect Rate (%) against Maximum", keys: { rate: "Defect Rate", notDone: null }, maximum: 5 });
    expect(chart?.axis).toEqual({ min: 0, max: 6, ticks: [0, 1, 2, 3, 4, 5, 6] });
    expect(chart?.rows.map((row) => [row.label, row.sublabel, row.rate, row.aside.map((line) => `${line.text} ${line.strong}`).join(", "), row.status])).toEqual([
      ["XS", "5 boxes", 0.48, "Defect Rate 0.48%, Total 3 / 625", "pass"],
      ["S", "8 boxes", 0, "Defect Rate 0%, Total 0 / 1,000", "pass"],
      ["M", "8 boxes", 1.1, "Defect Rate 1.1%, Total 11 / 1,000", "pass"],
      ["L", "5 boxes", 0, "Defect Rate 0%, Total 0 / 625", "pass"],
    ]);
    expect(chart?.rows.flatMap((row) => row.aside).some((line) => line.tone === "fail")).toBe(false);
  });

  it("lists every box by its No., size by size, its defects found in bold and none in grey, and each size's total", () => {
    const perBox = content.perBox;
    expect(perBox?.items).toBe(8);
    expect(perBox?.note).toEqual([{ text: "Defects found in each box of 125 gloves." }]);
    const xs = perBox?.sizes[0];
    expect(xs?.boxes.map((box) => [box?.boxNo.text, box?.defects.text, box?.defects.tone])).toEqual([
      ["1", "1", "found"],
      ["12", "0", "zero"],
      ["18", "0", "zero"],
      ["25", "0", "zero"],
      ["33", "2", "found"],
    ]);
    expect(perBox?.sizes.map((size) => [size.label, size.boxes.length, size.total.text, size.total.tone])).toEqual([
      ["XS", 5, "3", "total"],
      ["S", 8, "0", "total"],
      ["M", 8, "11", "total"],
      ["L", 5, "0", "total"],
    ]);
  });

  it("tables the defects by type per size in the template's words and order, then the total, the gloves inspected, the rate and the result", () => {
    expect(content.defects).toMatchObject({ title: "Safedon Packing Defects", firstHeader: "Defect", half: true });
    expect(content.defects.rows.map(rowOf)).toEqual([
      ["Boxes Tested", "5", "8", "8", "5"],
      ["No Cuff", "2", "0", "0", "0"],
      ["Finger Out", "0", "0", "0", "0"],
      ["Multiple Gloves Out", "0", "0", "0", "0"],
      ["Glove Stuck", "0", "0", "0", "0"],
      ["Sticky Glove", "1", "0", "11", "0"],
      ["Faulty Cuff", "0", "0", "0", "0"],
      ["Total", "3", "0", "11", "0"],
      ["Gloves Inspected", "625", "1,000", "1,000", "625"],
      ["Defect Rate (%)", "0.48%", "0%", "1.1%", "0%"],
      ["Conclusion", "pass", "pass", "pass", "pass"],
    ]);
    expect(tonesOf(content.defects.rows[5])).toEqual(["found", "zero", "found", "zero"]);
  });

  it("gives the template's definitions of its defects", () => {
    expect(content.definitions).toEqual([
      { code: "no_cuff", label: "No Cuff", hint: "Cuff should ideally be at least 2 cm out" },
      { code: "finger_out", label: "Finger Out", hint: "Only the cuff, not a finger, should come out first" },
      { code: "multiple_out", label: "Multiple Gloves Out", hint: "Only one glove should come out at a time" },
      { code: "stuck", label: "Glove Stuck", hint: "Glove could not be dispensed or was very difficult to dispense" },
      { code: "sticky", label: "Sticky Glove", hint: "Two or more gloves out at once because they stick together" },
      { code: "faulty_cuff", label: "Faulty Cuff", hint: "Deformed or misshapen cuff causing a dispensing problem" },
    ]);
  });

  it("prints on one page: the chart, the per-box table, the defects beside their definitions", () => {
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 8 }, { kind: "closing" }] }]);
    expect(content.pageCount).toBe(1);
  });
});

describe("one size, and five", () => {
  it("one size: says how it did, and keeps the tables to their own width", () => {
    const content = contentOf(dispensingExport({ M: { boxes: thirteen(8001, { 2: { no_cuff: 1 }, 6: { sticky: 2 }, 9: { finger_out: 1, sticky: 1 } }) } }));
    expect(content.lead).toBe(
      "Gloves dispensed from 13 plastic packs of 125 and checked for 6 dispensing defects (sampling code letter E). A size passes at a defect rate of 5% or less; size M passed.",
    );
    // The module's rate as computed (5 in 1,625 gloves), printed at two decimals as the module judges it.
    expect(content.chart?.rows.map((row) => [row.sublabel, row.rate, row.aside.map((line) => line.strong)])).toEqual([["13 boxes", expect.closeTo(0.3077, 4), ["0.31%", "5 / 1,625"]]]);
    expect(content.perBox?.items).toBe(13);
    expect(dispensingBoxGeometry(1, 184).table).toBe(54);
    // A label column of 40 mm and 15 mm for the size.
    expect(content.defects).toMatchObject({ half: true, width: 55, widths: { label: 72.727, value: 27.273 } });
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 13 }, { kind: "closing" }] }]);
  });

  it("five sizes: the defects still beside their definitions, on a second page under the full per-box table", () => {
    const content = contentOf(
      dispensingExport({
        XS: { boxes: thirteen(8001, { 1: { sticky: 1 } }) },
        S: { boxes: thirteen(8201, { 4: { no_cuff: 2 } }) },
        M: { boxes: thirteen(8401, { 0: { sticky: 3 }, 7: { sticky: 1 } }) },
        L: { boxes: thirteen(8601) },
        XL: { boxes: thirteen(8801, { 12: { faulty_cuff: 1 } }) },
      }),
    );
    expect(content.sizes.map((size) => size.label)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(content.defects.half).toBe(true);
    expect(rowIn(content, "rate")?.values.map((value) => value.text)).toEqual(["0.06%", "0.12%", "0.25%", "0%", "0.06%"]);
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 13 }] }, { parts: [{ kind: "closing" }] }]);
  });

  it("lays out the per-box table as the packing check's: one or two sizes at their own width, three or more across the page", () => {
    expect(dispensingBoxGeometry(1, 184)).toEqual({ table: 54, item: 14, box: expect.closeTo(22.4, 5), defects: expect.closeTo(17.6, 5) });
    expect(dispensingBoxGeometry(2, 184).table).toBe(94);
    expect(dispensingBoxGeometry(3, 184).table).toBe(184);
    expect(dispensingBoxGeometry(5, 184)).toMatchObject({ table: 184, item: 10 });
  });
});

describe("a failing size, sizes not done and a warned box/carton number", () => {
  const content = contentOf(failing());

  it("says which size failed at what rate, which passed and which are not done", () => {
    expect(content.lead).toBe(
      "Gloves dispensed from 15 plastic packs of 125 and checked for 6 dispensing defects (sampling code letters A, B and C). A size passes at a defect rate of 5% or less; size M failed at 6.4%; size S passed; sizes XS and L are not done yet.",
    );
  });

  it("draws the failed size in red on an axis past its rate, and a rate so far as not done", () => {
    const chart = content.chart;
    expect(chart?.axis).toEqual({ min: 0, max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(chart?.keys.notDone).toBe("Not done");
    expect(chart?.rows.map((row) => [row.label, row.sublabel, row.rate, row.status])).toEqual([
      ["XS", "2 of 3 boxes", 0.4, "not_done"],
      ["S", "5 boxes", 0, "pass"],
      ["M", "5 boxes", 6.4, "fail"],
      ["L", "3 of 5 boxes", 0.8, "not_done"],
    ]);
    expect(chart?.rows[2].aside).toEqual([
      { text: "Defect Rate", strong: "6.4%", tone: "fail" },
      { text: "Total", strong: "40 / 625", tone: "fail" },
    ]);
  });

  it("prints a box counted without its box/carton number as a dash, and the number S did not sample in amber, saying so", () => {
    const [xs, s, m] = content.perBox?.sizes ?? [];
    expect(xs.boxes.map((box) => [box?.boxNo, box?.defects.text])).toEqual([
      [{ text: "8001", tone: "plain" }, "1"],
      [{ text: "—", tone: "missing" }, "2"],
      [{ text: "8015", tone: "plain" }, "0"],
    ]);
    // The module's total is the boxes tested: the one without a number is left out.
    expect(xs.total).toEqual({ text: "1", tone: "total" });
    expect(s.boxes.map((box) => box?.boxNo.tone)).toEqual(["plain", "plain", "plain", "plain", "warn"]);
    expect(s.boxes[4]?.boxNo.text).toBe("8129");
    expect(m.total).toEqual({ text: "40", tone: "fail" });
    expect(content.perBox?.note).toEqual([
      { text: "Defects found in each box of 125 gloves. " },
      { text: "Amber: not one of the size's sampled box/carton numbers.", tone: "warn" },
    ]);
  });

  it("tables the boxes tested of those planned, the failing total and rate in red, a rate so far in grey, and each size's result", () => {
    expect(rowIn(content, "tested")?.values).toEqual([
      { text: "2 of 3", tone: "muted" },
      { text: "5", tone: "plain" },
      { text: "5", tone: "plain" },
      { text: "3 of 5", tone: "muted" },
    ]);
    expect(tonesOf(rowIn(content, "total"))).toEqual(["total", "total", "fail", "total"]);
    expect(rowIn(content, "rate")?.values).toEqual([
      { text: "0.4%", tone: "muted" },
      { text: "0%", tone: "plain" },
      { text: "6.4%", tone: "fail" },
      { text: "0.8%", tone: "muted" },
    ]);
    expect(rowIn(content, "result")?.statuses).toEqual(["not_done", "pass", "fail", "not_done"]);
  });
});

describe("nothing entered yet", () => {
  const content = contentOf(dispensingExport({ XS: { boxes: [], planned: 5 }, S: { boxes: [], planned: 8 }, M: { boxes: [], planned: 8 }, L: { boxes: [], planned: 5 } }));

  it("says no box is tested yet, and prints every figure as a dash", () => {
    expect(content.lead).toBe(
      "Gloves are dispensed from plastic packs of 125 and checked for 6 dispensing defects. A size passes at a defect rate of 5% or less; no plastic pack is tested yet.",
    );
    expect(content.chart?.rows.map((row) => [row.sublabel, row.rate, row.aside.map((line) => line.strong), row.status])).toEqual([
      ["0 of 5 boxes", null, ["—", "—"], "not_done"],
      ["0 of 8 boxes", null, ["—", "—"], "not_done"],
      ["0 of 8 boxes", null, ["—", "—"], "not_done"],
      ["0 of 5 boxes", null, ["—", "—"], "not_done"],
    ]);
    expect(content.chart?.keys.notDone).toBeNull();
    expect(content.perBox).toMatchObject({ items: 0, note: [{ text: "Defects found in each box of 125 gloves." }] });
    expect(content.perBox?.sizes.map((size) => size.total.text)).toEqual(["—", "—", "—", "—"]);
    expect(content.defects.rows.slice(1, -1).every((row) => row.values.every((value) => value.text === "—"))).toBe(true);
    expect(rowIn(content, "result")?.statuses).toEqual(["not_done", "not_done", "not_done", "not_done"]);
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 0 }, { kind: "closing" }] }]);
  });
});

describe("the template's words and settings", () => {
  it("uses the template's labels in the chart, the tables and the lead", () => {
    const content = contentOf(
      dispensingExport(
        { S: { boxes: dispensingBoxes(5, 8101) }, M: { boxes: dispensingBoxes(8, 8201, { sticky: 1 }) } },
        {
          labels: {
            boxNo: "Box #",
            boxDefects: "Defect Count",
            totalDefects: "Sum",
            ratePct: "Reject Rate (%)",
            counts: "Dispensing Defects",
            result: "Verdict",
            boxesTested: "Packs Tested",
            glovesInspected: "Gloves Checked",
            codeLetter: "Code Letter",
          },
        },
      ),
    );
    expect(content.words).toEqual({ no: "No.", boxNo: "Box #", defects: "Defect Count", total: "Sum" });
    expect(content.chart?.title).toBe("Reject Rate (%) against Maximum");
    expect(content.chart?.rows[1].aside).toEqual([
      { text: "Reject Rate", strong: "0.8%" },
      { text: "Sum", strong: "8 / 1,000" },
    ]);
    expect(content.defects.title).toBe("Dispensing Defects");
    expect(content.defects.rows.map((row) => row.label)).toEqual([
      "Packs Tested",
      "No Cuff",
      "Finger Out",
      "Multiple Gloves Out",
      "Glove Stuck",
      "Sticky Glove",
      "Faulty Cuff",
      "Sum",
      "Gloves Checked",
      "Reject Rate (%)",
      "Verdict",
    ]);
    expect(content.lead).toContain("(code letters C and D)");
  });

  it("follows the template's maximum, gloves per pack and defects; a defect without a definition has no line among them", () => {
    const content = contentOf(
      dispensingExport(
        { M: { boxes: [...dispensingBoxes(4, 8201), { boxNo: 8229, counts: { sticky: 3 } }] } },
        {
          config: {
            maxRatePct: 2,
            glovesPerPack: 100,
            defects: [
              { code: "no_cuff", label: "No Cuff", hint: "" },
              { code: "sticky", label: "Sticky Glove", hint: "Gloves stick together" },
            ],
          },
        },
      ),
    );
    expect(content.lead).toBe(
      "Gloves dispensed from 5 plastic packs of 100 and checked for 2 dispensing defects (sampling code letter C). A size passes at a defect rate of 2% or less; size M passed.",
    );
    expect(content.chart).toMatchObject({ maximum: 2, axis: { min: 0, max: 2.5, ticks: [0, 0.5, 1, 1.5, 2, 2.5] } });
    expect(content.chart?.rows[0].aside.map((line) => line.strong)).toEqual(["0.6%", "3 / 500"]);
    expect(content.perBox?.note).toEqual([{ text: "Defects found in each box of 100 gloves." }]);
    expect(content.defects.rows.map((row) => row.label)).toEqual(["Boxes Tested", "No Cuff", "Sticky Glove", "Total", "Gloves Inspected", "Defect Rate (%)", "Conclusion"]);
    expect(content.definitions).toEqual([{ code: "sticky", label: "Sticky Glove", hint: "Gloves stick together" }]);
  });
});

describe("the report's options", () => {
  const doc = makeSafedonExport();

  it("draws the chart and the per-box table by their switches, the defects and their definitions whenever the section prints", () => {
    const noChart = contentOf(switched(doc, { averageLayeringDispensing: false, perBoxResults: true, agedGloves: false, stickinessGrades: false }));
    expect(noChart.chart).toBeNull();
    expect(noChart.pages).toEqual([{ parts: [{ kind: "perBox", from: 0, to: 8 }, { kind: "closing" }] }]);
    const noBoxes = contentOf(switched(doc, { averageLayeringDispensing: true, perBoxResults: false, agedGloves: false, stickinessGrades: false }));
    expect(noBoxes.perBox).toBeNull();
    expect(noBoxes.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "closing" }] }]);
    // The packing check's blocks alone (on by default): the defects and their definitions still print, never "coming next".
    const theirs = sectionOf(switched(doc, { averageLayeringDispensing: false, perBoxResults: false, agedGloves: true, stickinessGrades: true }));
    expect(theirs.entry?.built).toBe(true);
    expect(theirs.content?.pages).toEqual([{ parts: [{ kind: "closing" }] }]);
    // Every block off: the section is left out.
    const none = switched(doc, { averageLayeringDispensing: false, perBoxResults: false, agedGloves: false, stickinessGrades: false });
    expect(sectionOf(none).entry).toBeUndefined();
  });

  it("moves the defects and their definitions to a second page on Letter under a footer note", () => {
    const content = contentOf(withReportOptions(doc, { pageSize: "letter", footerNote: "For the buyer's quality team only. Not for distribution beyond the purchasing office and the factory." }));
    expect(content.pages).toEqual([{ parts: [{ kind: "chart" }, { kind: "perBox", from: 0, to: 8 }] }, { parts: [{ kind: "closing" }] }]);
  });
});

describe("the pages", () => {
  const long = () =>
    dispensingExport({
      S: { boxes: dispensingBoxes(40, 9001, { sticky: 1 }) },
      M: { boxes: dispensingBoxes(40, 9401) },
      L: { boxes: dispensingBoxes(32, 9801) },
      XL: { boxes: dispensingBoxes(20, 9901) },
    });

  it("runs the per-box table on to the next page when its boxes do not fit, every box once, the total with the last", () => {
    const { entry, content } = sectionOf(long());
    const pages = content?.pages ?? [];
    expect(pages.length).toBe(2);
    expect(entry?.pageCount).toBe(2);
    const chunks = pages.flatMap((page) => page.parts).filter((part) => part.kind === "perBox");
    expect(chunks[0]).toMatchObject({ from: 0 });
    chunks.slice(1).forEach((chunk, index) => expect(chunk.from).toBe(chunks[index].to));
    expect(chunks.at(-1)?.to).toBe(40);
    for (const chunk of chunks.slice(1)) expect(chunk.to - chunk.from).toBeGreaterThanOrEqual(MIN_BOX_ROWS);
    expect(pages.at(-1)?.parts.at(-1)).toEqual({ kind: "closing" });
  });

  it("never leaves fewer than MIN_BOX_ROWS to go on with the total, and starts the table on the next page rather than under the chart with fewer", () => {
    const body = contentOf(long());
    for (let room = 120; room <= 260; room += 0.5) {
      const parts = planGloveDispensing(body, { room, width: 184 }).flatMap((page) => page.parts);
      const chunks = parts.filter((part) => part.kind === "perBox");
      expect(chunks.at(-1)?.to).toBe(40);
      for (const chunk of chunks) expect(chunk.to - chunk.from).toBeGreaterThanOrEqual(MIN_BOX_ROWS);
    }
  });

  it("prints every part, a page each, where a page has room for none: the defects and their definitions one under the other", () => {
    const body = contentOf(makeSafedonExport());
    expect(planGloveDispensing(body, { room: 10, width: 184 }).map((page) => page.parts)).toEqual([
      [{ kind: "chart" }],
      [{ kind: "perBox", from: 0, to: 8 }],
      [{ kind: "defects", from: 0, to: 11 }],
      [{ kind: "definitions", from: 0, to: 6 }],
    ]);
  });

  it("runs a list of defects too long for a page side by side on, one block under the other, each split between pages", () => {
    const defects = Array.from({ length: 60 }, (_, index) => ({
      code: `d${index + 1}`,
      label: `Defect ${index + 1}`,
      hint: "A definition long enough to wrap onto a second line in its half of the page, as some templates write them.",
    }));
    const content = contentOf(dispensingExport({ M: { boxes: dispensingBoxes(5, 8201) } }, { config: { defects } }));
    const parts = content.pages.flatMap((page) => page.parts);
    expect(parts).not.toContainEqual({ kind: "closing" });
    const tables = parts.filter((part) => part.kind === "defects");
    const lists = parts.filter((part) => part.kind === "definitions");
    expect(tables.length).toBeGreaterThan(1);
    expect(lists.length).toBeGreaterThan(1);
    for (const run of [tables, lists]) {
      expect(run[0]).toMatchObject({ from: 0 });
      run.slice(1).forEach((part, index) => expect(part.from).toBe(run[index].to));
    }
    expect(tables.at(-1)?.to).toBe(content.defects.rows.length);
    expect(lists.at(-1)?.to).toBe(60);
    expect(content.pageCount).toBe(content.pages.length);
  });
});
