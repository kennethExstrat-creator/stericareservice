import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { ModuleTagSchema } from "@/lib/inspections/photos/schemas";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { MODULE_REGISTRY } from "@/modules";
import type { ModuleRegistry } from "@/modules/_framework/contract";
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
    expect(onlyS).toEqual({ data, filled: 0, modules: [] });
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

  it("keeps the file's id where the AI says it belongs and nothing is kept yet, never an id the AI wrote", () => {
    const result = linkSourceFile({
      proposals: {
        tensile: { labReport: KEPT, sizes: {} },
        documents: { items: { labTestReports: { referenceNo: "LAB-0001", file: KEPT } } },
      },
      attachTo: ["tensile", "force_at_break", "documents.labTestReports", "documents.iso13485", "visual", "tensile"],
      fileId: FILE,
      // Force at break keeps another report already; iso13485 is off the checklist; visual keeps no file.
      data: { modules: { force_at_break: { labReport: KEPT } }, custom: {} },
      registry: MODULE_REGISTRY,
      modules,
    });
    expect(result.linked).toEqual(["tensile", "documents.labTestReports"]);
    expect(result.proposals.tensile).toEqual({ sizes: {}, labReport: FILE });
    expect(result.proposals.documents).toEqual({ items: { labTestReports: { referenceNo: "LAB-0001", file: FILE } } });
    expect(result.proposals).not.toHaveProperty("force_at_break");
    expect(result.kind).toBe("lab_report");
  });

  it("links nothing without attachTo, or for a module the reading may not fill", () => {
    const result = linkSourceFile({
      proposals: { force_at_break: { labReport: KEPT } },
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
