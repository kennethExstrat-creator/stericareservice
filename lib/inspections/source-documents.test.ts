import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { ModuleTagSchema } from "@/lib/inspections/photos/schemas";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import {
  applyProposals,
  countFilled,
  fillEmpty,
  isMediaCategoryKey,
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_KEYS,
  mediaCategory,
  mediaCounts,
  mediaKind,
  SOURCE_DOCUMENTS_KEY,
  SOURCE_MEDIA_KEY,
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

describe("mediaCounts", () => {
  it("counts each category's photos and videos, and puts the rest of the photos and the first tab's videos under Other", () => {
    const photos = [
      { moduleKey: "media_warehouse" },
      { moduleKey: "media_warehouse" },
      { moduleKey: "media_defects" },
      // Other: untagged, and a step's photo from before the categories.
      { moduleKey: null },
      { moduleKey: "visual" },
    ];
    const files = [
      { moduleKey: "media_proof" },
      { moduleKey: SOURCE_MEDIA_KEY },
      // Not media: Source Documents' papers and a step's lab report.
      { moduleKey: SOURCE_DOCUMENTS_KEY },
      { moduleKey: "tensile" },
    ];
    const counts = mediaCounts(photos, files);
    expect(counts.categories.map(({ category, photos: shown, videos }) => [category.key, shown, videos])).toEqual([
      ["media_warehouse", 2, 0],
      ["media_samples", 0, 0],
      ["media_proof", 0, 1],
      ["media_defects", 1, 0],
    ]);
    expect(counts.other).toEqual({ photos: 2, videos: 1 });
    expect(mediaCounts([], []).other).toEqual({ photos: 0, videos: 0 });
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
