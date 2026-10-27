import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { ModuleTagSchema } from "@/lib/inspections/photos/schemas";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { MODULE_REGISTRY } from "@/modules";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import type { InspectionData } from "@/modules/_framework/data";
import {
  applyProposals,
  countFilled,
  fillEmpty,
  filesToFill,
  isMediaCategoryKey,
  linkSourceFile,
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_KEYS,
  mediaCategory,
  mediaKind,
  SOURCE_DOCUMENTS_KEY,
  SOURCE_MEDIA_KEY,
  sourceFileStatus,
  type SourceFileStatus,
} from "./source-documents";

describe("Media's categories", () => {
  it("are the four Kenneth named, in his order, with Title Case titles and a one-sentence hint", () => {
    expect(MEDIA_CATEGORIES.map((category) => category.title)).toEqual([
      "Warehouse",
      "Product and Package Samples",
      "Inspection Proof",
      "Product Defects",
    ]);
    expect(MEDIA_CATEGORY_KEYS).toEqual(["media_warehouse", "media_samples", "media_proof", "media_defects"]);
    for (const { title, hint } of MEDIA_CATEGORIES) {
      expect(lowerCaseWords(title), title).toEqual([]);
      expect(hint, title).toMatch(/^[A-Z][^.]*\.$/);
    }
    expect(mediaCategory("media_proof")?.hint).toBe("Photos of the inspection under way, as proof it was done.");
  });

  it("are keys a photo can be tagged with, never a module's or Source Documents' own", () => {
    for (const key of MEDIA_CATEGORY_KEYS) {
      // The edit dialog's form and the retag action check the tag with this schema.
      expect(ModuleTagSchema.safeParse(key).success, key).toBe(true);
      expect((MODULE_KEYS as readonly string[]).includes(key), key).toBe(false);
    }
    expect(new Set(MEDIA_CATEGORY_KEYS).size).toBe(MEDIA_CATEGORY_KEYS.length);
    expect(MEDIA_CATEGORY_KEYS).not.toContain(SOURCE_DOCUMENTS_KEY);
    expect(MEDIA_CATEGORY_KEYS).not.toContain(SOURCE_MEDIA_KEY);
  });

  it("tells a category's key from any other", () => {
    expect(mediaCategory("media_warehouse")?.title).toBe("Warehouse");
    expect(isMediaCategoryKey("media_defects")).toBe(true);
    for (const key of ["visual", SOURCE_MEDIA_KEY, "media", "", null, undefined]) {
      expect(mediaCategory(key), String(key)).toBeNull();
      expect(isMediaCategoryKey(key), String(key)).toBe(false);
    }
  });
});

describe("mediaKind", () => {
  it("tells a dropped photo from a video by its type, else by its name, and takes nothing else", () => {
    expect(mediaKind({ type: "image/jpeg", name: "IMG_0001.JPG" })).toBe("photo");
    expect(mediaKind({ type: "video/quicktime", name: "IMG_0002.MOV" })).toBe("video");
    // Some browsers give a HEIC photo or a QuickTime movie no type.
    expect(mediaKind({ type: "", name: "IMG_0003.HEIC" })).toBe("photo");
    expect(mediaKind({ type: "", name: "clip.mov" })).toBe("video");
    expect(mediaKind({ type: "application/pdf", name: "PO-0001.pdf" })).toBeNull();
    expect(mediaKind({ type: "", name: "notes.txt" })).toBeNull();
  });

  it("takes no spreadsheet, whatever type it comes with: dropped on Media or Auto-Sort, it is refused for Files (Kenneth, 26 October 2026)", () => {
    expect(mediaKind({ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "PO-0001.xlsx" })).toBeNull();
    expect(mediaKind({ type: "application/vnd.ms-excel", name: "Packing list.xls" })).toBeNull();
    expect(mediaKind({ type: "application/vnd.ms-excel", name: "Order.csv" })).toBeNull();
    expect(mediaKind({ type: "text/csv", name: "Order.csv" })).toBeNull();
    expect(mediaKind({ type: "", name: "Order.csv" })).toBeNull();
  });
});

const OrderSchema = z.strictObject({
  sizes: z
    .record(z.string(), z.strictObject({ qtyCases: z.number().int().nullable().default(null), lotNumbers: z.array(z.string()).default([]) }))
    .default({}),
});
const HeaderSchema = z.strictObject({ poNo: z.string().nullable().default(null), productCode: z.string().nullable().default(null) });

const registry = {
  header: { dataSchema: HeaderSchema, emptyData: () => HeaderSchema.parse({}) },
  order_lots: { dataSchema: OrderSchema, emptyData: () => OrderSchema.parse({}) },
  conclusion: { dataSchema: z.object({ finalResult: z.string().nullable() }), emptyData: () => ({ finalResult: null }) },
} as unknown as ModuleRegistry;

describe("fillEmpty", () => {
  it("fills only what holds nothing", () => {
    expect(fillEmpty({ a: null, b: "kept", c: [null, 2] }, { a: "new", b: "other", c: [1, 3] })).toEqual({ a: "new", b: "kept", c: [1, 2] });
    expect(countFilled({ a: null, c: [null, 2] }, { a: "new", c: [1, 2] })).toBe(2);
  });
});

describe("applyProposals", () => {
  it("fills empty fields of included modules, size by size, and never the conclusion", () => {
    const data = {
      modules: { header: { poNo: null, productCode: "KEPT", comment: "note" }, order_lots: { sizes: {} }, conclusion: { finalResult: null } },
      custom: {},
    };
    const result = applyProposals(
      data,
      {
        header: { poNo: "PO-0001", productCode: "OTHER" },
        order_lots: { sizes: { M: { qtyCases: 120, lotNumbers: ["LOT-A01"] }, L: { qtyCases: "twelve" } } },
        conclusion: { finalResult: "pass" },
        glove_info: { colour: "Blue" },
      },
      registry,
      new Set(["header", "order_lots", "conclusion"]),
    );
    expect(result.data.modules.header).toEqual({ poNo: "PO-0001", productCode: "KEPT", comment: "note" });
    expect(result.data.modules.order_lots).toEqual({ sizes: { M: { qtyCases: 120, lotNumbers: ["LOT-A01"] } } });
    expect(result.data.modules.conclusion).toEqual({ finalResult: null });
    expect(result.filled).toBe(3);
    expect(result.modules).toEqual(["header", "order_lots"]);
    // The order is no per-size step: its table shows every size, ordered or not.
    expect(result.sizes).toEqual([]);
  });
});

describe("applyProposals on Box/Carton Numbers (Kenneth, 14 October 2026)", () => {
  // Placeholders (docs/FIXTURES.md): the 13 boxes of a size's dispensing test, in the form's order.
  const TESTED = [41, 233, 360, 512, 707, 919, 1108, 1350, 1622, 1905, 2187, 2401, 2856];
  const included = new Set(["carton_sampling", "dispensing_packing"]);
  const cartons = (data: { modules: Readonly<Record<string, unknown>> }) => data.modules.carton_sampling;

  it("fills a size's empty list with the numbers read, rows 1 to 13 in the document's order, beside the dispensing step", () => {
    const boxes = TESTED.map((boxNo) => ({ boxNo, layeringPct: 88, dispensingPct: 90, stickiness: "A" }));
    const proposals = { carton_sampling: { sizes: { S: { cartonNumbers: TESTED } } }, dispensing_packing: { sizes: { S: { boxes } } } };
    const result = applyProposals({ modules: {}, custom: {} }, proposals, MODULE_REGISTRY, included);
    expect(cartons(result.data)).toEqual({ sizes: { S: { cartonNumbers: TESTED } } });
    const dispensing = result.data.modules.dispensing_packing as { sizes: { S: { boxes: { boxNo: number }[] } } };
    expect(dispensing.sizes.S.boxes.map((box) => box.boxNo)).toEqual(TESTED);
    expect(result.modules).toEqual(["carton_sampling", "dispensing_packing"]);
    // 13 box/carton numbers, and 4 values in each of the 13 boxes.
    expect(result.filled).toBe(13 + 13 * 4);
    // The size they went in for: the steps show it once it is ordered.
    expect(result.sizes).toEqual(["S"]);

    // A size the table shows with no number in it yet is empty too.
    const shown = { modules: { carton_sampling: { sizes: { S: { cartonNumbers: [] } } } }, custom: {} };
    expect(cartons(applyProposals(shown, { carton_sampling: proposals.carton_sampling }, MODULE_REGISTRY, included).data)).toEqual({
      sizes: { S: { cartonNumbers: TESTED } },
    });
  });

  it("leaves a list that holds any number alone, gaps and all, and still fills another size's empty list", () => {
    // Typed into row 3 only: laid in gap by gap, the 1st and 2nd numbers read would land in rows 1 and 2.
    const data = { modules: { carton_sampling: { sizes: { S: { cartonNumbers: [null, null, 1500] }, M: { cartonNumbers: [] } } } }, custom: {} };
    const onlyS = applyProposals(data, { carton_sampling: { sizes: { S: { cartonNumbers: TESTED } } } }, MODULE_REGISTRY, included);
    expect(onlyS).toEqual({ data, filled: 0, modules: [], sizes: [] });
    expect(onlyS.data).toBe(data);

    const both = applyProposals(
      data,
      { carton_sampling: { sizes: { S: { cartonNumbers: TESTED }, M: { cartonNumbers: [3001, 3420] } } } },
      MODULE_REGISTRY,
      included,
    );
    expect(cartons(both.data)).toEqual({ sizes: { S: { cartonNumbers: [null, null, 1500] }, M: { cartonNumbers: [3001, 3420] } } });
    expect(both.filled).toBe(2);
  });

  it("completes a list from a fuller one holding every number it has, in the document's order (Kenneth, 26 October 2026)", () => {
    // The dispensing page's 4 boxes first, then the finished goods sampling sheet's 8 sampled cartons, the 4 among them.
    const dispensing = [233, 512, 919, 1350];
    const sheet = [41, 233, 360, 512, 707, 919, 1108, 1350];
    const data = { modules: { carton_sampling: { sizes: { S: { cartonNumbers: dispensing } } } }, custom: {} };
    const result = applyProposals(data, { carton_sampling: { sizes: { S: { cartonNumbers: sheet } } } }, MODULE_REGISTRY, included);
    expect(cartons(result.data)).toEqual({ sizes: { S: { cartonNumbers: sheet } } });
    expect(result.filled).toBe(4);
    // Another order's sheet, without the boxes already there: the list stays as it is.
    const other = applyProposals(data, { carton_sampling: { sizes: { S: { cartonNumbers: [5, 6, 7, 8, 9] } } } }, MODULE_REGISTRY, included);
    expect(other).toEqual({ data, filled: 0, modules: [], sizes: [] });
    // The same numbers again, or fewer: nothing to add.
    expect(applyProposals(data, { carton_sampling: { sizes: { S: { cartonNumbers: dispensing } } } }, MODULE_REGISTRY, included).filled).toBe(0);
    expect(applyProposals(data, { carton_sampling: { sizes: { S: { cartonNumbers: [233, 512] } } } }, MODULE_REGISTRY, included).filled).toBe(0);
  });

  it("keeps a repeated number out, as the table's paste does (pasteCartons), with whatever is no box/carton number, leaving no gap", () => {
    const proposal = { sizes: { S: { cartonNumbers: [41, 233, 41, "360", null, 0, 52.5, -7, 512, 233] } } };
    const result = applyProposals({ modules: {}, custom: {} }, { carton_sampling: proposal }, MODULE_REGISTRY, included);
    expect(cartons(result.data)).toEqual({ sizes: { S: { cartonNumbers: [41, 233, 512] } } });
    expect(result.filled).toBe(3);
    // Nothing that is a box/carton number: nothing filled.
    expect(applyProposals({ modules: {}, custom: {} }, { carton_sampling: { sizes: { S: { cartonNumbers: ["41", null] } } } }, MODULE_REGISTRY, included))
      .toMatchObject({ filled: 0, modules: [] });
  });

  it("takes at most the 2,000 numbers a size holds, the first ones read, as the table's paste does", () => {
    const read = Array.from({ length: 2001 }, (_, index) => index + 1);
    const result = applyProposals({ modules: {}, custom: {} }, { carton_sampling: { sizes: { S: { cartonNumbers: read } } } }, MODULE_REGISTRY, included);
    expect((cartons(result.data) as { sizes: { S: { cartonNumbers: number[] } } }).sizes.S.cartonNumbers).toEqual(read.slice(0, 2000));
    expect(result.filled).toBe(2000);
  });
});

describe("applyProposals on Dimension's specs (Kenneth, 26 October 2026)", () => {
  const included = new Set(["dimensions"]);
  const sizeS = (data: { modules: Readonly<Record<string, unknown>> }) =>
    (data.modules.dimensions as { sizes: Record<string, Record<string, unknown>> }).sizes.S;
  const STRICT = { kind: "tolerance", nominal: 0.18, tolerance: 0.04 };

  it("takes the specs a Spec row gives, NA included, beside the readings", () => {
    const proposal = {
      sizes: { S: { gloves: [{ length: 245 }], specOverrides: { length: { kind: "min", min: 230 }, fingerThickness: { kind: "na" } } } },
    };
    const result = applyProposals({ modules: {}, custom: {} }, { dimensions: proposal }, MODULE_REGISTRY, included);
    expect(sizeS(result.data).specOverrides).toEqual({ length: { kind: "min", min: 230 }, fingerThickness: { kind: "na" } });
    expect((sizeS(result.data).gloves as { length: number }[])[0].length).toBe(245);
    expect(result.modules).toEqual(["dimensions"]);
  });

  it("leaves a spec already set for the size and column whole, and still fills the readings and the other columns", () => {
    const data = { modules: { dimensions: { sizes: { S: { gloves: [], specOverrides: { fingerThickness: STRICT } } } } }, custom: {} };
    const proposal = {
      sizes: { S: { gloves: [{ width: 86 }], specOverrides: { fingerThickness: { kind: "na" }, palmThickness: { kind: "na" } } } },
    };
    const result = applyProposals(data, { dimensions: proposal }, MODULE_REGISTRY, included);
    expect(sizeS(result.data).specOverrides).toEqual({ fingerThickness: STRICT, palmThickness: { kind: "na" } });
    expect((sizeS(result.data).gloves as { width: number }[])[0].width).toBe(86);
  });

  it("never takes a P/F set by hand from a reading", () => {
    const proposal = { sizes: { S: { manualResults: { width: { result: "pass", comment: "As the form says." } } } } };
    const result = applyProposals({ modules: {}, custom: {} }, { dimensions: proposal }, MODULE_REGISTRY, included);
    expect(result).toMatchObject({ filled: 0, modules: [] });
  });
});

describe("applyProposals on the packing check's aged sample (Kenneth, 26 October 2026)", () => {
  const included = new Set(["dispensing_packing"]);
  // Placeholder box/carton numbers (docs/FIXTURES.md): a size's 8 boxes, as read from a dispensing page.
  const BOXES = [101, 102, 103, 104, 105, 106, 107, 108].map((boxNo) => ({ boxNo, layeringPct: 90, dispensingPct: 92, stickiness: "A" }));
  const AGED = { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" };
  type Packing = { sizes: Record<string, { boxes: unknown[]; agedSample?: unknown }> };
  const packing = (data: { modules: Readonly<Record<string, unknown>> }) => data.modules.dispensing_packing as Packing;

  it("fills the size's aged sample beside its boxes, never a ninth box", () => {
    const result = applyProposals(
      { modules: {}, custom: {} },
      { dispensing_packing: { sizes: { S: { boxes: BOXES, agedSample: AGED } } } },
      MODULE_REGISTRY,
      included,
    );
    expect(packing(result.data).sizes.S.boxes).toHaveLength(8);
    expect(packing(result.data).sizes.S.agedSample).toEqual(AGED);
    // 4 values in each of the 8 boxes, and the aged sample's 4.
    expect(result.filled).toBe(8 * 4 + 4);
  });

  it("lands in an empty aged sample of a size whose boxes are entered, and keeps what one holds", () => {
    const entered = { modules: { dispensing_packing: { sizes: { S: { boxes: BOXES } } } }, custom: {} };
    const filled = applyProposals(entered, { dispensing_packing: { sizes: { S: { agedSample: AGED } } } }, MODULE_REGISTRY, included);
    expect(packing(filled.data).sizes.S).toEqual({ boxes: BOXES.map((box) => ({ ...box, note: null })), agedSample: AGED });
    expect(filled.filled).toBe(4);

    const held = { modules: { dispensing_packing: { sizes: { S: { boxes: BOXES, agedSample: { layeringPct: 87, dispensingPct: null, stickiness: null, note: null } } } } }, custom: {} };
    const completed = applyProposals(held, { dispensing_packing: { sizes: { S: { agedSample: AGED } } } }, MODULE_REGISTRY, included);
    expect(packing(completed.data).sizes.S.agedSample).toEqual({ ...AGED, layeringPct: 87 });
    expect(completed.filled).toBe(3);
  });

  it("leaves out an aged sample its schema refuses, and still fills the boxes", () => {
    const result = applyProposals(
      { modules: {}, custom: {} },
      { dispensing_packing: { sizes: { S: { boxes: BOXES, agedSample: { ...AGED, boxNo: 109 } } } } },
      MODULE_REGISTRY,
      included,
    );
    expect(packing(result.data).sizes.S.boxes).toHaveLength(8);
    expect(packing(result.data).sizes.S).not.toHaveProperty("agedSample");
  });
});

describe("applyProposals on Packing Configuration (Kenneth, 27 October 2026: the gloves per case is worked out)", () => {
  const included = new Set(["packing_config"]);
  const packing = (data: { modules: Readonly<Record<string, unknown>> }) => data.modules.packing_config;

  it("fills the two counts a document states and works the gloves per case out from them, counted as the two read", () => {
    const result = applyProposals({ modules: {}, custom: {} }, { packing_config: { glovesPerInner: 100, innersPerCase: 10 } }, MODULE_REGISTRY, included);
    expect(packing(result.data)).toEqual({ glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: null });
    expect(result.filled).toBe(2);
  });

  it("takes a gloves per case the document states as read, even beside counts it is not the product of, and only while empty", () => {
    const stated = applyProposals(
      { modules: {}, custom: {} },
      { packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1200 } },
      MODULE_REGISTRY,
      included,
    );
    expect(packing(stated.data)).toMatchObject({ glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1200 });

    // A document that states only the gloves per case fills it while it is empty, and nothing else.
    const alone = applyProposals({ modules: {}, custom: {} }, { packing_config: { glovesPerCase: 2000 } }, MODULE_REGISTRY, included);
    expect(packing(alone.data)).toEqual({ glovesPerInner: null, innersPerCase: null, glovesPerCase: 2000, packingMode: null });
    const typed = { modules: { packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: null } }, custom: {} };
    const kept = applyProposals(typed, { packing_config: { glovesPerCase: 2000 } }, MODULE_REGISTRY, included);
    expect(kept.filled).toBe(0);
    expect(packing(kept.data)).toEqual(typed.modules.packing_config);
  });
});

describe("applyProposals on the sampling plan's inner boxes (Kenneth, 27 October 2026)", () => {
  const included = new Set(["sampling_plan"]);
  type Plan = { sizes: Record<string, { cases: number | null; innerUnitsPerCase: number | null; innerUnits: number | null }> };
  const plan = (data: { modules: Readonly<Record<string, unknown>> }) => data.modules.sampling_plan as Plan;

  it("takes the paper form's inner boxes as the total, with no count per case", () => {
    const result = applyProposals({ modules: {}, custom: {} }, { sampling_plan: { sizes: { S: { cases: 16, innerUnits: 16 } } } }, MODULE_REGISTRY, included);
    expect(plan(result.data).sizes.S).toMatchObject({ cases: 16, innerUnitsPerCase: null, innerUnits: 16 });
    expect(result.filled).toBe(2);
  });

  it("works out the total from a count per case a document states, as typing does, counted as the two read", () => {
    const result = applyProposals(
      { modules: {}, custom: {} },
      { sampling_plan: { sizes: { S: { cases: 16, innerUnitsPerCase: 2 } } } },
      MODULE_REGISTRY,
      included,
    );
    expect(plan(result.data).sizes.S).toMatchObject({ cases: 16, innerUnitsPerCase: 2, innerUnits: 32 });
    expect(result.filled).toBe(2);
  });

  it("keeps a total already entered, and refuses a count per case below 1", () => {
    const entered = { modules: { sampling_plan: { sizes: { S: { cases: 16, innerUnits: 20 } } } }, custom: {} };
    const kept = applyProposals(entered, { sampling_plan: { sizes: { S: { innerUnitsPerCase: 2 } } } }, MODULE_REGISTRY, included);
    // Calc then warns on the total: 20 is not 16 × 2.
    expect(plan(kept.data).sizes.S).toMatchObject({ innerUnitsPerCase: 2, innerUnits: 20 });
    const refused = applyProposals(entered, { sampling_plan: { sizes: { S: { innerUnitsPerCase: 0 } } } }, MODULE_REGISTRY, included);
    expect(refused.filled).toBe(0);
  });
});

describe("linkSourceFile", () => {
  const FILE = "00000000-0000-4000-8000-000000000501";
  const KEPT = "00000000-0000-4000-8000-000000000502";
  const modules = [
    { key: "tensile", config: {} },
    { key: "force_at_break", config: {} },
    {
      key: "documents",
      config: {
        items: [
          { key: "labTestReports", include: true, required: false },
          { key: "iso13485", include: false, required: false },
        ],
      },
    },
  ];

  it("links the file where the AI says it belongs, beside a step's other lab reports, never by an id the AI wrote", () => {
    const result = linkSourceFile({
      proposals: {
        tensile: { labReport: KEPT, labReports: [{ fileId: KEPT, sizes: ["M"] }], sizes: {} },
        documents: { items: { labTestReports: { referenceNo: "LAB-0001", file: KEPT } } },
      },
      attachTo: ["tensile", "force_at_break", "documents.labTestReports", "documents.iso13485", "visual", "tensile"],
      fileId: FILE,
      // Force at break keeps another report already; iso13485 is off the checklist; visual keeps no file.
      data: { modules: { force_at_break: { labReports: [{ fileId: KEPT, sizes: ["S"] }] } }, custom: {} },
      registry: MODULE_REGISTRY,
      modules,
    });
    expect(result.linked).toEqual(["tensile", "force_at_break", "documents.labTestReports"]);
    expect(result.proposals.tensile).toEqual({ sizes: {}, labReports: [{ fileId: FILE, sizes: [] }] });
    expect(result.proposals.force_at_break).toEqual({ labReports: [{ fileId: FILE, sizes: [] }] });
    expect(result.proposals.documents).toEqual({ items: { labTestReports: { referenceNo: "LAB-0001", file: FILE } } });
    expect(result.kind).toBe("lab_report");
  });

  it("links a documents row's file only where none is kept yet", () => {
    const result = linkSourceFile({
      proposals: {},
      attachTo: ["documents.labTestReports"],
      fileId: FILE,
      data: { modules: { documents: { items: { labTestReports: { file: KEPT } } } }, custom: {} },
      registry: MODULE_REGISTRY,
      modules,
    });
    expect(result).toEqual({ proposals: {}, linked: [], kind: "lab_report" });
  });

  it("links nothing without attachTo, or for a module the reading may not fill", () => {
    const result = linkSourceFile({
      proposals: { force_at_break: { labReport: KEPT, labReports: [{ fileId: KEPT, sizes: [] }] } },
      attachTo: ["force_at_break"],
      fileId: FILE,
      data: { modules: {}, custom: {} },
      registry: MODULE_REGISTRY,
      modules: [{ key: "tensile", config: {} }],
    });
    expect(result).toEqual({ proposals: { force_at_break: {} }, linked: [], kind: null });
    expect(linkSourceFile({ proposals: {}, attachTo: [], fileId: FILE, data: { modules: {}, custom: {} }, registry: MODULE_REGISTRY, modules }))
      .toEqual({ proposals: {}, linked: [], kind: null });
  });
});

describe("lab reports, one per size (Kenneth, 26 October 2026: \"there are 4 different source\")", () => {
  // Placeholders for INS-2026-2437's four per-size lab reports, S, M, L and XL.
  const FILES = {
    S: "00000000-0000-4000-8000-000000000511",
    M: "00000000-0000-4000-8000-000000000512",
    L: "00000000-0000-4000-8000-000000000513",
    XL: "00000000-0000-4000-8000-000000000514",
  } as const;
  const SIZES = ["S", "M", "L", "XL"] as const;
  const modules = [
    { key: "force_at_break", config: {} },
    { key: "tensile", config: {} },
  ];
  const included = new Set(modules.map((module) => module.key));
  const EMPTY = { modules: {}, custom: {} };
  const readings = (first: number) => Array.from({ length: 13 }, (_, index) => Math.round((first + index * 0.01) * 1000) / 1000);

  /** What Steri-AI answers for one size's report: its readings, and the report filed with force at break. */
  function reading(size: (typeof SIZES)[number], data: InspectionData) {
    return linkSourceFile({
      proposals: { force_at_break: { sizes: { [size]: { values: readings(6.1) } } } },
      attachTo: ["force_at_break"],
      fileId: FILES[size],
      data,
      registry: MODULE_REGISTRY,
      modules,
    });
  }

  const reportsOf = (data: InspectionData) => (data.modules.force_at_break as { labReports: unknown }).labReports;

  it("links each report read after another with the sizes it gives, never in place of one linked before", () => {
    let data: InspectionData = EMPTY;
    for (const size of SIZES) {
      const link = reading(size, data);
      expect(link.linked, size).toEqual(["force_at_break"]);
      expect(link.kind).toBe("lab_report");
      expect(link.proposals.force_at_break).toEqual({ sizes: { [size]: { values: readings(6.1) } }, labReports: [{ fileId: FILES[size], sizes: [size] }] });
      const filled = applyProposals(data, link.proposals, MODULE_REGISTRY, included);
      // The 13 readings and the report.
      expect(filled.filled, size).toBe(14);
      data = filled.data;
    }
    expect(reportsOf(data)).toEqual(SIZES.map((size) => ({ fileId: FILES[size], sizes: [size] })));
  });

  it("keeps every report when the four readings finish together: none is lost to the one filled first", () => {
    // Each read against the data as it was when the four were uploaded: nothing linked yet.
    const links = SIZES.map((size) => reading(size, EMPTY));
    let data: InspectionData = EMPTY;
    for (const link of [links[1], links[0], links[3], links[2]]) data = applyProposals(data, link.proposals, MODULE_REGISTRY, included).data;
    expect(reportsOf(data)).toEqual([
      { fileId: FILES.M, sizes: ["M"] },
      { fileId: FILES.S, sizes: ["S"] },
      { fileId: FILES.XL, sizes: ["XL"] },
      { fileId: FILES.L, sizes: ["L"] },
    ]);
    const forceAtBreak = data.modules.force_at_break as { sizes: Record<string, { values: number[] }> };
    expect(Object.keys(forceAtBreak.sizes).sort()).toEqual(["L", "M", "S", "XL"]);
  });

  it("links a new report beside one saved alone before, and gives a report read again the sizes it lacked", () => {
    const saved = { modules: { force_at_break: { sizes: {}, labReport: FILES.S } }, custom: {} };
    const m = reading("M", saved);
    expect(m.linked).toEqual(["force_at_break"]);
    const withM = applyProposals(saved, m.proposals, MODULE_REGISTRY, included).data;
    expect(withM.modules.force_at_break).toEqual({
      sizes: { M: { values: readings(6.1) } },
      labReports: [
        { fileId: FILES.S, sizes: [] },
        { fileId: FILES.M, sizes: ["M"] },
      ],
    });
    // Read Again on S: it is linked already, and now its size is known.
    const again = reading("S", withM);
    expect(again.linked).toEqual(["force_at_break"]);
    const withS = applyProposals(withM, again.proposals, MODULE_REGISTRY, included).data;
    expect(reportsOf(withS)).toEqual([
      { fileId: FILES.S, sizes: ["S"] },
      { fileId: FILES.M, sizes: ["M"] },
    ]);
    // Read once more: nothing new to link or fill.
    const twice = reading("S", withS);
    expect(twice.linked).toEqual([]);
    expect(twice.proposals.force_at_break).toEqual({ sizes: { S: { values: readings(6.1) } } });
    expect(applyProposals(withS, twice.proposals, MODULE_REGISTRY, included).filled).toBe(0);
  });

  it("fills in a reading kept before 26 October 2026, which linked its file as labReport, as one more report", () => {
    const pending = { force_at_break: { labReport: FILES.L, sizes: { L: { values: readings(6.2) } } } };
    const withM = { modules: { force_at_break: { sizes: {}, labReports: [{ fileId: FILES.M, sizes: ["M"] }] } }, custom: {} };
    const result = applyProposals(withM, pending, MODULE_REGISTRY, included);
    expect(reportsOf(result.data)).toEqual([
      { fileId: FILES.M, sizes: ["M"] },
      { fileId: FILES.L, sizes: ["L"] },
    ]);
    expect(result.filled).toBe(14);
  });

  it("files one report for several sizes under each of them, and links it to every step it holds results for", () => {
    const link = linkSourceFile({
      proposals: {
        force_at_break: { sizes: { S: { values: readings(6.1) }, M: { values: readings(6.3) }, L: { values: [] } } },
        tensile: { sizes: { M: { tensileStrength: 24.04, elongationAtBreak: 720 } } },
      },
      attachTo: ["force_at_break", "tensile"],
      fileId: FILES.S,
      data: EMPTY,
      registry: MODULE_REGISTRY,
      modules,
    });
    expect(link.linked).toEqual(["force_at_break", "tensile"]);
    expect(link.proposals.force_at_break?.labReports).toEqual([{ fileId: FILES.S, sizes: ["S", "M"] }]);
    expect(link.proposals.tensile?.labReports).toEqual([{ fileId: FILES.S, sizes: ["M"] }]);
  });
});

describe("a reading kept with its file (Kenneth, 26 October 2026: filled in by the next screen when the one that started it was left)", () => {
  const proposals = { sampling_plan: { sizes: { S: { gloves: 200 } } } };
  const row = (patch: Partial<Parameters<typeof sourceFileStatus>[0]>) =>
    sourceFileStatus({ ai_status: "read", ai_summary: "Sampling plan table.", ai_proposals: null, ai_filled_at: null, ...patch });

  it("brings the proposals no screen has filled in, and none once one has", () => {
    expect(row({ ai_proposals: proposals })).toEqual({ status: "read", summary: "Sampling plan table.", pending: proposals });
    expect(row({ ai_proposals: proposals, ai_filled_at: "2026-10-26T10:00:00.000Z" })).toEqual({
      status: "read",
      summary: "Sampling plan table.",
    });
  });

  it("brings nothing for a file read before the proposals were kept, nor for proposals that are no module data", () => {
    expect(row({})).toEqual({ status: "read", summary: "Sampling plan table." });
    expect(row({ ai_proposals: [] })).toEqual({ status: "read", summary: "Sampling plan table." });
    expect(row({ ai_proposals: { sampling_plan: "200", header: null } })).toEqual({ status: "read", summary: "Sampling plan table." });
    // Only the module data goes on.
    expect(row({ ai_proposals: { ...proposals, header: 3 } })?.pending).toEqual(proposals);
  });

  it("reads a failed file as failed, and an unread one as nothing yet", () => {
    expect(row({ ai_status: "failed", ai_summary: "Not a document.", ai_proposals: proposals })).toEqual({
      status: "failed",
      summary: "Not a document.",
    });
    expect(row({ ai_status: null, ai_summary: null })).toBeNull();
  });

  it("lists the uploaded files whose reading waits, in their order", () => {
    const files = [{ id: "a", name: "form.jpg" }, { id: "b", name: "po.pdf" }, { id: "c", name: "plan.jpg" }];
    const statuses: Record<string, SourceFileStatus> = {
      a: { status: "read", summary: null },
      b: { status: "read", summary: null, pending: proposals },
      c: { status: "read", summary: null, pending: { header: { poNumber: "PO-0001" } } },
    };
    expect(filesToFill(files, statuses).map(({ file, proposals: waiting }) => [file.name, Object.keys(waiting)])).toEqual([
      ["po.pdf", ["sampling_plan"]],
      ["plan.jpg", ["header"]],
    ]);
    expect(filesToFill(files, { b: { status: "reading", summary: null, pending: proposals } })).toEqual([]);
  });
});
