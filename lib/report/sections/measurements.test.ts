// Section 04, Measurements by Glove (TG35 page 4), as its builder fills the
// slot from the export: a table per size of every glove's readings, the
// statistic, the spec in force and the result in the template's words, two
// tables side by side and as many rows as a page holds, from the
// placeholder example reports and changed copies of them run through the
// real modules. The model is built whole, as the report builds it.
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { buildReportModel, type MeasurementsSection, type ReportSectionPlanEntry } from "../model";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { failingSafedon, fourSizes, safedonWith, sizesOf, stdEgWith, withSizeXL } from "./__fixtures__/dimensions";

function measurementsOf(doc: InspectionExport): MeasurementsSection {
  const content = buildReportModel(doc).sections.measurements;
  if (!content) throw new Error("Section 04 was not built.");
  return content;
}

/** Each page's rows of tables by their titles. */
const layoutOf = (content: MeasurementsSection) => content.pages.map((page) => page.rows.map((row) => row.map((table) => table.title)));

describe("Section 04: Measurements by Glove", () => {
  it("heads the section with the unit and the gloves per size, and names the rows in the template's words", () => {
    const content = measurementsOf(makeStdEgExport());
    expect(content.aside).toBe("All values in mm · 13 gloves per size");
    expect(content.labels).toEqual({ no: "No.", statistic: "Median", spec: "Spec.", result: "Result" });
    expect(content.columns).toEqual([
      { measure: "length", label: "Length" },
      { measure: "width", label: "Width" },
      { measure: "fingerThickness", label: "Finger" },
      { measure: "palmThickness", label: "Palm" },
      { measure: "cuffThickness", label: "Cuff" },
    ]);
  });

  it("tables every glove of a size, headed by its lot and average weight, at the template's decimals", () => {
    const content = measurementsOf(makeStdEgExport());
    expect(content.pageCount).toBe(1);
    expect(layoutOf(content)).toEqual([[["Size M"]]]);
    const [table] = content.pages[0].rows[0];
    expect(table).toMatchObject({ size: "M", aside: "Lot LOT-A01 · Avg. weight 2.90 g", continued: false });
    expect(table.gloves).toHaveLength(13);
    expect(table.gloves[1]).toEqual({
      no: 2,
      cells: {
        length: { text: "245", failed: false },
        width: { text: "94", failed: false },
        // 0.1 as the design prints it, at two decimals.
        fingerThickness: { text: "0.10", failed: false },
        palmThickness: { text: "0.05", failed: false },
        cuffThickness: { text: "0.04", failed: false },
      },
    });
    expect(table.summary).toEqual({
      statistic: {
        length: { text: "245", failed: false },
        width: { text: "95", failed: false },
        fingerThickness: { text: "0.09", failed: false },
        palmThickness: { text: "0.05", failed: false },
        cuffThickness: { text: "0.04", failed: false },
      },
      spec: { length: "≥ 240", width: "95 ± 10", fingerThickness: "NA", palmThickness: "NA", cuffThickness: "NA" },
      result: Object.fromEntries(
        ["length", "width", "fingerThickness", "palmThickness", "cuffThickness"].map((measure) => [measure, { text: "Passed", status: "pass", byHand: false }]),
      ),
      status: "pass",
    });
    expect(content.pages[0].note).toBeNull();
  });

  it("puts four sizes on a page, two tables side by side, in the template's words and measures", () => {
    const safedon = measurementsOf(makeSafedonExport());
    expect(safedon.aside).toBe("All values in mm · 13 gloves per size");
    expect(layoutOf(safedon)).toEqual([
      [
        ["Size XS", "Size S"],
        ["Size M", "Size L"],
      ],
    ]);
    expect(safedon.labels.statistic).toBe("Average");
    expect(safedon.columns.map((column) => column.label)).toEqual(["Length", "Width", "Finger", "Palm"]);
    const [xs] = safedon.pages[0].rows[0];
    expect(xs.aside).toBe("Lot LOT-B01 · Avg. weight 2.56 g");
    expect(xs.summary?.result.length).toEqual({ text: "A", status: "pass", byHand: false });
    expect(xs.summary?.spec).toEqual({ length: "≥ 230", width: "76 ± 4", fingerThickness: "0.18 ± 0.04", palmThickness: "0.14 ± 0.04" });
    expect(layoutOf(measurementsOf(stdEgWith(fourSizes)))).toEqual([
      [
        ["Size S", "Size M"],
        ["Size L", "Size XL"],
      ],
    ]);
  });

  it("shows readings outside the spec in force and a failed statistic in red, a P/F set by hand marked, and says what both mean", () => {
    const content = measurementsOf(safedonWith(failingSafedon));
    const tables = Object.fromEntries(content.pages.flatMap((page) => page.rows.flat()).map((table) => [table.size, table]));
    // Size S's length is judged against at least 245 mm for this inspection.
    expect(tables.S.gloves.map((glove) => [glove.cells.length.text, glove.cells.length.failed])).toEqual([
      ["243", true],
      ["242", true],
      ["242", true],
      ["244", true],
      ["243", true],
      ["242", true],
      ["241", true],
      ["243", true],
      ["245", false],
      ["244", true],
      ["246", false],
      ["244", true],
      ["245", false],
    ]);
    expect(tables.S.summary?.statistic.length).toEqual({ text: "243", failed: true });
    expect(tables.S.summary?.spec.length).toBe("≥ 245");
    expect(tables.S.summary?.result.length).toEqual({ text: "Rej.", status: "fail", byHand: false });
    expect(tables.S.summary?.status).toBe("fail");
    expect(tables.M.summary?.result.width).toEqual({ text: "Rej.", status: "fail", byHand: true });
    expect(tables.M.gloves.every((glove) => !glove.cells.width.failed)).toBe(true);
    expect(tables.XS.summary?.status).toBe("pass");
    expect(content.pages[0].note).toBe("* Set by the inspector. Readings in red are outside the spec; the average is judged.");
  });

  it("dashes a reading not entered and says its result is not done", () => {
    const content = measurementsOf(
      safedonWith((modules) => {
        const s = sizesOf(modules, "dimensions").S;
        s.gloves = (s.gloves as Record<string, unknown>[]).map((glove, index) => (index === 2 ? { ...glove, width: null } : glove));
      }),
    );
    const s = content.pages[0].rows[0][1];
    expect(s.gloves[2].cells.width).toEqual({ text: "—", failed: false });
    expect(s.summary?.result.width).toEqual({ text: "Not Done", status: "not_done", byHand: false });
    expect(s.summary?.status).toBe("not_done");
  });

  it("puts a fifth size on a page of its own", () => {
    const five = measurementsOf(safedonWith(withSizeXL));
    expect(layoutOf(five)).toEqual([
      [
        ["Size XS", "Size S"],
        ["Size M", "Size L"],
      ],
      [["Size XL"]],
    ]);
    expect(five.pages[1].rows[0][0].summary?.spec).toEqual({ length: "NA", width: "NA", fingerThickness: "NA", palmThickness: "NA" });
  });

  it("goes on with a size's gloves past a page in a table of its own, the summary on its last", () => {
    // Size M sampled for 90 gloves of dimension.
    const content = measurementsOf(
      stdEgWith((modules) => {
        const plan = sizesOf(modules, "sampling_plan");
        plan.M = { ...plan.M, glovesDimensions: 90 };
        const dimensions = sizesOf(modules, "dimensions");
        const gloves = dimensions.M.gloves as Record<string, unknown>[];
        dimensions.M = { gloves: Array.from({ length: 90 }, (_, index) => gloves[index % gloves.length]) };
      }),
    );
    const tables = content.pages.flatMap((page) => page.rows.flat());
    expect(tables.length).toBeGreaterThan(2);
    expect(tables.map((table) => table.title)).toEqual(["Size M", ...tables.slice(1).map(() => "Size M (continued)")]);
    expect(tables.flatMap((table) => table.gloves.map((glove) => glove.no))).toEqual(Array.from({ length: 90 }, (_, index) => index + 1));
    expect(tables.map((table) => table.summary !== null)).toEqual([...tables.slice(1).map(() => false), true]);
    expect(content.aside).toBe("All values in mm · 90 gloves per size");
    expect(content.pageCount).toBe(content.pages.length);
  });

  it("holds less on Letter's shorter page: a row of two tables a page", () => {
    expect(layoutOf(measurementsOf(withReportOptions(makeSafedonExport(), { pageSize: "letter" })))).toEqual([[["Size XS", "Size S"]], [["Size M", "Size L"]]]);
  });

  it("builds nothing before a glove is measured: the page says coming next", () => {
    const doc = safedonWith((modules) => {
      modules.dimensions = { sizes: {} };
    });
    const model = buildReportModel(doc);
    expect(model.sections.measurements).toBeUndefined();
    expect(model.plan.find((entry): entry is ReportSectionPlanEntry => entry.kind === "section" && entry.key === "measurements")).toMatchObject({
      built: false,
      pageCount: 1,
    });
  });
});
