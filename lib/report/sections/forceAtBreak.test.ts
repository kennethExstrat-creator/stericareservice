// Section 05, Force at Break, from the export (lib/report/sections/
// forceAtBreak.ts): the placeholder examples (STD_EG: size M, no standard;
// SAFEDON_EG: tensile, sizes XS to L, the lab report not attached) and the
// STD_EG inspection ordered in more sizes with made-up readings, run
// through the real modules (lib/report/__fixtures__/force-at-break.ts).
import { describe, expect, it } from "vitest";
import type { InspectionExport } from "@/lib/schemas/export";
import { makeSafedonExport, makeStdEgExport, withReportOptions } from "../__fixtures__/exports";
import { FOUR_SIZES, forceExport } from "../__fixtures__/force-at-break";
import { buildReportModel, type ForceAtBreakSection, type ReportSectionPlanEntry } from "../model";
import { buildForceAtBreak, chartAxis, spreadOf, stackingStep, summaryLabelShare } from "./forceAtBreak";

/** The section's plan entry and content in the report's model. */
function sectionOf(doc: InspectionExport): { entry: ReportSectionPlanEntry<"forceAtBreak"> | undefined; content: ForceAtBreakSection | undefined } {
  const model = buildReportModel(doc);
  const entry = model.plan.find((candidate): candidate is ReportSectionPlanEntry<"forceAtBreak"> => candidate.key === "forceAtBreak");
  return { entry, content: model.sections.forceAtBreak };
}

function contentOf(doc: InspectionExport): ForceAtBreakSection {
  const { content } = sectionOf(doc);
  if (!content) throw new Error("No force at break content.");
  return content;
}

/** The export with these force at break blocks switched on or off. */
function withBlocks(doc: InspectionExport, blocks: Partial<Record<"laboratoryDetails" | "maximumLoad" | "specimenReadings" | "laboratorySummary", boolean>>): InspectionExport {
  return withReportOptions(doc, {
    sections: { ...doc.report.sections, forceAtBreak: { include: true, blocks: { ...doc.report.sections.forceAtBreak.blocks, ...blocks } } },
  });
}

describe("the force at break test, one size (STD_EG)", () => {
  const { entry, content } = sectionOf(makeStdEgExport());

  it("fills the section's slot: built, titled by the design, on one page", () => {
    expect(entry).toMatchObject({ kicker: "Section 05", title: "Force at Break", moduleKeys: ["force_at_break"], built: true, pageCount: 1 });
    expect(content?.pageCount).toBe(1);
  });

  it("leads with the minimum and the specimens from the config, with no standard set and no card for it", () => {
    expect(content?.lead).toBe("The median of 13 specimens must reach 6 N.");
    expect(content?.details).toBeNull();
    expect(content?.tensile).toBeNull();
  });

  it("keeps each reading as entered, the module's median and verdict, the readings' figures and the order's lot", () => {
    const size = content?.force?.sizes[0];
    expect(size).toMatchObject({
      size: "M",
      label: "M",
      n: 13,
      median: 6.537,
      medianText: "6.537",
      range: "6.297 to 6.837",
      average: "6.553",
      sd: "0.176",
      minimum: { value: 6.297, text: "6.297", low: false },
      maximum: { value: 6.837, text: "6.837", low: false },
      lots: "LOT-A01",
      status: "pass",
      stack: 1,
    });
    expect(size?.readings.map((reading) => reading?.text)).toEqual([
      "6.587",
      "6.637",
      "6.687",
      "6.497",
      "6.457",
      "6.417",
      "6.537",
      "6.377",
      "6.337",
      "6.297",
      "6.737",
      "6.787",
      "6.837",
    ]);
  });

  it("words the labels as the template does, and names the lab report the readings come from", () => {
    expect(content?.force).toMatchObject({
      specMin: 6,
      specText: "6 N",
      medianLabel: "Median",
      rowLabel: "No.",
      lotLabel: "Lot Number",
      rows: 13,
      notes: [],
      labNote: "Readings from the lab report attached, for size M.",
    });
  });

  it("names the same lab report in the Report page's preview, whose export lists no files, from the module's own state", () => {
    const preview = { ...makeStdEgExport(), files: [] };
    expect(contentOf(preview).force?.labNote).toBe("Readings from the lab report attached, for size M.");
    const none = makeStdEgExport();
    const force = none.modules.find((module) => module.key === "force_at_break");
    if (!force) throw new Error("No force at break module.");
    force.computed = { ...force.computed, labReportAttached: false };
    // The lab report is optional for this test: nothing is said without one.
    expect(contentOf({ ...none, files: [] }).force?.labNote).toBeNull();
  });

  it("lays the chart out from the minimum to just past the highest reading, ticks at the step's decimals", () => {
    expect(content?.force?.axis).toEqual({ min: 5.8, max: 7, ticks: [5.8, 6, 6.2, 6.4, 6.6, 6.8, 7] });
    expect(content?.force?.tickDecimals).toBe(1);
  });

  it("draws the chart, then the readings beside the lab's summary, on its one page", () => {
    expect(content?.pages).toEqual([
      {
        parts: [
          { kind: "forceChart", sizes: ["M"], notes: false },
          { kind: "forceTables", readings: { from: 0, to: 13, median: true }, summary: true, paired: true },
        ],
      },
    ]);
  });
});

describe("four sizes, as the design lays them out", () => {
  const content = contentOf(forceExport(FOUR_SIZES));
  const force = content.force;

  it("leads with the standard, the specimens per size and the minimum, and shows the standard in the details card", () => {
    expect(content.lead).toBe("Lab test to EN 455-2. The median of 13 specimens per size must reach 6 N.");
    expect(content.details).toEqual([{ key: "standard", label: "Standard", value: "EN 455-2" }]);
  });

  it("judges every size by its median, as the module does, and marks the specimen below the minimum", () => {
    expect(force?.sizes.map((size) => [size.label, size.medianText, size.status])).toEqual([
      ["S", "6.3", "pass"],
      ["M", "6.5", "pass"],
      ["L", "6.6", "pass"],
      ["XL", "6.6", "pass"],
    ]);
    const low = force?.sizes.flatMap((size) => size.readings.flatMap((reading, index) => (reading?.low ? [`${size.size} ${index + 1}: ${reading.text}`] : [])));
    expect(low).toEqual(["S 4: 5.5"]);
    expect(force?.sizes[0]).toMatchObject({ range: "5.5 to 6.9", average: "6.4", sd: "0.4", minimum: { text: "5.5", low: true }, maximum: { text: "6.9" } });
  });

  it("notes the size that passes although a specimen read below the minimum, in the standard's words", () => {
    expect(force?.notes).toEqual(["* One size S specimen read 5.5 N. EN 455-2 judges the median, which is 6.3 N for size S, so the size passes."]);
  });

  it("spans the chart from 5.0 to 7.5 N in half newtons, and stacks repeated readings", () => {
    expect(force?.axis).toEqual({ min: 5, max: 7.5, ticks: [5, 5.5, 6, 6.5, 7, 7.5] });
    expect(force?.step).toBe(0.1);
    expect(force?.sizes.map((size) => size.stack)).toEqual([2, 2, 3, 4]);
  });

  it("fits on one page: the details, the chart with its note, the readings beside the summary", () => {
    expect(content.pages).toEqual([
      {
        parts: [
          { kind: "details" },
          { kind: "forceChart", sizes: ["S", "M", "L", "XL"], notes: true },
          { kind: "forceTables", readings: { from: 0, to: 13, median: true }, summary: true, paired: true },
        ],
      },
    ]);
    expect(force?.labNote).toBe("Readings from the lab report attached, for sizes S, M, L and XL.");
  });
});

describe("a failing size and readings still to enter", () => {
  const content = contentOf(
    forceExport({
      readings: {
        S: [5.6, 5.9, 6.1, 5.5, 5.8, 6.2, 5.7, 6.0, 5.9, 5.8, 6.3, 5.6, 5.9],
        M: [6.4, 5.8, 6.2, null, 6.5],
        L: [],
      },
      lots: { S: ["LOT-S1", "LOT-S2"], L: [] },
    }),
  );
  const [s, m, l] = content.force?.sizes ?? [];

  it("keeps the module's verdicts: the median below the minimum fails, a size with readings missing is not done", () => {
    expect([s.status, m.status, l.status]).toEqual(["fail", "not_done", "not_done"]);
    expect(s.medianText).toBe("5.900");
    expect([m.median, l.median]).toEqual([null, null]);
  });

  it("holds a place for each reading to enter, and no figures for a size with none", () => {
    expect(m.readings.map((reading) => reading?.text ?? null)).toEqual(["6.4", "5.8", "6.2", null, "6.5", null, null, null, null, null, null, null, null]);
    expect(l).toMatchObject({ n: 13, range: null, average: null, sd: null, minimum: null, maximum: null, lots: null, stack: 0 });
    expect(l.readings.every((reading) => reading === null)).toBe(true);
    expect(s.lots).toBe("LOT-S1, LOT-S2");
  });

  it("notes each size with a specimen below the minimum: why it failed, or that its median waits for the rest", () => {
    expect(content.force?.notes).toEqual([
      "* Nine size S specimens read below 6 N. The test judges the median, which is 5.900 N for size S, below 6 N, so the size fails.",
      "* One size M specimen read 5.8 N. The test judges the median once all 13 specimens are read.",
    ]);
  });

  it("leads without a standard where the template sets none", () => {
    expect(content.lead).toBe("The median of 13 specimens per size must reach 6 N.");
  });
});

describe("the blocks switched on", () => {
  const doc = forceExport(FOUR_SIZES);

  it("leave out the details, the chart, or the readings: the summary then spans the page", () => {
    const content = contentOf(withBlocks(doc, { laboratoryDetails: false, specimenReadings: false }));
    expect(content.details).toBeNull();
    expect(content.pages).toEqual([
      {
        parts: [
          { kind: "forceChart", sizes: ["S", "M", "L", "XL"], notes: true },
          { kind: "forceTables", readings: null, summary: true, paired: false },
        ],
      },
    ]);
    const tables = contentOf(withBlocks(doc, { maximumLoad: false, laboratorySummary: false })).pages[0].parts;
    expect(tables).toEqual([{ kind: "details" }, { kind: "forceTables", readings: { from: 0, to: 13, median: true }, summary: false, paired: false }]);
  });

  it("print 'coming next' when nothing switched on has anything to show", () => {
    const empty = forceExport({ readings: { M: [] }, config: { standardLabel: null } });
    const { entry, content } = sectionOf(withBlocks(empty, { laboratorySummary: false }));
    expect(entry).toMatchObject({ built: false, pageCount: 1 });
    expect(content).toBeUndefined();
  });

  it("give nothing to build with no size on the order", () => {
    const doc = makeStdEgExport();
    const order = doc.modules.find((module) => module.key === "order_lots");
    if (order) order.data = { sizes: {} };
    const entry: ReportSectionPlanEntry<"forceAtBreak"> = {
      kind: "section",
      key: "forceAtBreak",
      number: 5,
      kicker: "Section 05",
      title: "Force at Break",
      blocks: [{ key: "laboratorySummary", label: "Laboratory Summary" }],
      moduleKeys: ["force_at_break"],
      pageCount: 1,
      built: false,
    };
    expect(buildForceAtBreak(doc, entry)).toBeNull();
  });
});

describe("pages", () => {
  it("move a block that does not fit to the next page whole, headed '(Continued)'", () => {
    const content = contentOf(
      forceExport({ ...FOUR_SIZES, readings: { XS: FOUR_SIZES.readings.M, ...FOUR_SIZES.readings, XL: [6.5, 6.6, 6.6, 6.6, 6.6, 6.6, 6.6, 5.4, 5.4, 5.6, 5.8, 5.9, 5.9] } }),
    );
    expect(content.pageCount).toBe(2);
    expect(content.pages.map((page) => page.parts.map((part) => part.kind))).toEqual([["details", "forceChart"], ["forceTables"]]);
  });

  it("split readings taller than a page by rows: the summary beside the first stretch, the Median under the last", () => {
    const forty = Array.from({ length: 40 }, (_, index) => Number((6 + ((index * 7) % 13) / 10).toFixed(1)));
    const doc = forceExport({ readings: { S: forty, M: forty, L: forty }, physical: 40, config: { standardLabel: "EN 455-2" } });
    const { entry, content } = sectionOf(doc);
    expect(content?.force?.rows).toBe(40);
    expect(content?.lead).toBe("Lab test to EN 455-2. The median of 40 specimens per size must reach 6 N.");
    const stretches = content?.pages.flatMap((page) => page.parts.flatMap((part) => (part.kind === "forceTables" ? [part] : []))) ?? [];
    expect(stretches.length).toBeGreaterThan(1);
    expect(stretches[0]).toMatchObject({ summary: true, paired: true, readings: { from: 0, median: false } });
    expect(stretches.slice(1).every((part) => !part.summary)).toBe(true);
    expect(stretches.at(-1)?.readings).toMatchObject({ to: 40, median: true });
    // Every row once, in order.
    stretches.forEach((part, index) => {
      if (index > 0) expect(part.readings?.from).toBe(stretches[index - 1].readings?.to);
    });
    expect(entry?.pageCount).toBe(content?.pages.length);
    // Letter is shorter than A4: never fewer pages.
    const letter = contentOf(withReportOptions(doc, { pageSize: "letter" }));
    expect(letter.pageCount).toBeGreaterThanOrEqual(content?.pageCount ?? 0);
  });
});

describe("more sizes than the design's five", () => {
  it("stack the readings and the summary, each across the page", () => {
    const doc = forceExport(FOUR_SIZES);
    const order = doc.modules.find((module) => module.key === "order_lots");
    const force = doc.modules.find((module) => module.key === "force_at_break");
    if (!order || !force) throw new Error("No order or force at break module.");
    const added = { XS: FOUR_SIZES.readings.M, XXL: FOUR_SIZES.readings.L };
    order.data = { ...order.data, sizes: { ...(order.data.sizes as object), XS: { qtyCases: 10, lotNumbers: [], packingSite: null }, XXL: { qtyCases: 10, lotNumbers: [], packingSite: null } } };
    force.data = { ...force.data, sizes: { ...(force.data.sizes as object), XS: { values: [...added.XS] }, XXL: { values: [...added.XXL] } } };
    const content = contentOf(doc);
    expect(content.force?.sizes.map((size) => size.size)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    const tables = content.pages.flatMap((page) => page.parts.filter((part) => part.kind === "forceTables"));
    expect(tables).toEqual([
      { kind: "forceTables", readings: { from: 0, to: 13, median: true }, summary: false, paired: false },
      { kind: "forceTables", readings: null, summary: true, paired: false },
    ]);
  });
});

describe("Physical Properties (tensile, SAFEDON_EG)", () => {
  const { entry, content } = sectionOf(makeSafedonExport());

  it("is titled by the test, leads with the standard and both minimums, and shows the standard", () => {
    expect(entry).toMatchObject({ title: "Physical Properties", moduleKeys: ["tensile"], built: true, pageCount: 1 });
    expect(content?.lead).toBe("Lab test to ASTM D6319. Each size's average tensile strength must reach 14 MPa and its average elongation at break 500%.");
    expect(content?.details).toEqual([{ key: "standard", label: "Standard", value: "ASTM D6319" }]);
    expect(content?.force).toBeNull();
  });

  it("keeps each size's averages at the template's decimals, the lots and the module's verdicts", () => {
    expect(content?.tensile?.sizes.map((size) => [size.label, size.tensile?.text, size.elongation?.figure, size.lots, size.status])).toEqual([
      ["XS", "34.18 MPa", "536", "LOT-B01", "pass"],
      ["S", "32.99 MPa", "547", "LOT-B02", "pass"],
      ["M", "34.03 MPa", "555", "LOT-B03", "pass"],
      ["L", "33.17 MPa", "543", "LOT-B04", "pass"],
    ]);
    expect(content?.tensile).toMatchObject({
      tensileLabel: "Tensile Strength (Average) (MPa)",
      elongationLabel: "Elongation at Break, Average (%)",
      tensileMin: { value: 14, text: "14 MPa" },
      elongationMin: { value: 500, text: "500%" },
      tensileAxis: { min: 0, max: 40 },
      elongationAxis: { min: 0, max: 600 },
      labNote: "No lab report is attached.",
    });
  });

  it("names the lab report once the module counts one attached, the sizes it gives where it keeps them", () => {
    const doc = makeSafedonExport();
    const tensile = doc.modules.find((module) => module.key === "tensile");
    if (!tensile) throw new Error("No tensile module.");
    tensile.computed = { ...tensile.computed, labReportAttached: true };
    expect(contentOf(doc).tensile?.labNote).toBe("Averages from the lab report attached.");
    tensile.data = { ...tensile.data, labReports: [{ fileId: "00000000-0000-4000-8000-000000000401", sizes: ["XS", "S"] }] };
    expect(contentOf(doc).tensile?.labNote).toBe("Averages from the lab report attached, for sizes XS and S.");
  });

  it("has no specimens to plot or list: the bars and the summary", () => {
    expect(content?.pages).toEqual([{ parts: [{ kind: "details" }, { kind: "tensileChart" }, { kind: "tensileSummary" }] }]);
  });

  it("marks an average below its minimum as the module judged it", () => {
    const doc = makeSafedonExport();
    const tensile = doc.modules.find((module) => module.key === "tensile");
    if (!tensile) throw new Error("No tensile module.");
    tensile.data = { ...tensile.data, sizes: { ...(tensile.data.sizes as object), S: { tensileStrength: 12.5, elongationAtBreak: 547 } } };
    tensile.computed = { ...tensile.computed, sizes: { ...(tensile.computed.sizes as object), S: { tensileResult: "fail", elongationResult: "pass" } } };
    const size = contentOf(doc).tensile?.sizes.find((entry) => entry.size === "S");
    expect(size?.tensile).toEqual({ value: 12.5, figure: "12.50", text: "12.50 MPa", fail: true });
    expect(size?.elongation?.fail).toBe(false);
  });
});

describe("both tests in one inspection", () => {
  it("titles the section by the design and prints the readings, then the averages", () => {
    const doc = forceExport(FOUR_SIZES);
    const tensile = makeSafedonExport().modules.find((module) => module.key === "tensile");
    if (!tensile) throw new Error("No tensile module.");
    const conclusion = doc.modules.findIndex((module) => module.key === "conclusion");
    doc.modules.splice(conclusion, 0, tensile);
    const { entry, content } = sectionOf(doc);
    expect(entry).toMatchObject({ title: "Force at Break", moduleKeys: ["force_at_break", "tensile"] });
    expect(content?.lead).toBe(
      "Lab test to EN 455-2 and ASTM D6319. The median of 13 specimens per size must reach 6 N. Each size's average tensile strength must reach 14 MPa and its average elongation at break 500%.",
    );
    expect(content?.details).toEqual([{ key: "standard", label: "Standard", value: "EN 455-2, ASTM D6319" }]);
    // The order is S to XL: tensile has no XL figures.
    expect(content?.tensile?.sizes.map((size) => [size.size, size.tensile?.figure ?? null])).toEqual([
      ["S", "32.99"],
      ["M", "34.03"],
      ["L", "33.17"],
      ["XL", null],
    ]);
    const kinds = content?.pages.flatMap((page) => page.parts.map((part) => part.kind));
    expect(kinds).toEqual(["details", "forceChart", "forceTables", "tensileChart", "tensileSummary"]);
    expect(content?.pageCount).toBe(2);
  });
});

describe("the arithmetic", () => {
  it("spreadOf: the mean and the sample standard deviation, none for too few", () => {
    expect(spreadOf([])).toEqual({ mean: null, sd: null });
    expect(spreadOf([6])).toEqual({ mean: 6, sd: null });
    const { mean, sd } = spreadOf([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBe(5);
    expect(sd).toBeCloseTo(2.138, 3);
  });

  it("chartAxis: half a step under the lowest of the readings and the minimum, a quarter step past the highest", () => {
    expect(chartAxis([5.5, 7.3], 6)).toEqual({ min: 5, max: 7.5, ticks: [5, 5.5, 6, 6.5, 7, 7.5] });
    // Every reading above the minimum: the zone under it still shows.
    expect(chartAxis([6.2, 7], 6).min).toBeLessThan(6);
    // A reading on a tick leaves room past it: the next tick (steps of 0.2 N here).
    expect(chartAxis([6.1, 7], 6)).toEqual({ min: 5.8, max: 7.2, ticks: [5.8, 6, 6.2, 6.4, 6.6, 6.8, 7, 7.2] });
    expect(chartAxis([], null)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
  });

  it("stackingStep: the readings' precision, or a dot's width along the axis where readings are finer", () => {
    expect(stackingStep({ min: 5, max: 7.5 }, 1, 130)).toBe(0.1);
    expect(stackingStep({ min: 5.8, max: 7 }, 3, 130)).toBe(0.024);
    expect(stackingStep({ min: 0, max: 1 }, 0, 130)).toBe(1);
  });

  it("summaryLabelShare: the label column narrows as sizes are added", () => {
    expect([1, 3, 4, 5].map((sizes) => summaryLabelShare(sizes))).toEqual([0.3, 0.3, 0.26, 0.22]);
    expect(summaryLabelShare(5, true)).toBe(0.3);
  });
});
