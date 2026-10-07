import { describe, expect, it } from "vitest";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import {
  countFiles,
  countPhotos,
  defectChoices,
  defectName,
  displayTags,
  EMPTY_TAG_OPTIONS,
  groupByModule,
  humanizeKey,
  itemName,
  levelName,
  moduleOption,
  moduleTitle,
  photoObjectPaths,
  previewPath,
  readOnlyReason,
  tagOptionsFromTemplate,
  targetForModule,
  targetKeysFor,
  toMediaFile,
  toMediaPhoto,
  UNTAGGED_TITLE,
  type PhotoRow,
  type PhotoTagOptions,
} from "./view";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ADMIN = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

const DEFECTS = [
  { code: "bead_defective", name: "Defective bead" },
  { code: "hole_palm", name: "Hole in palm" },
  { code: "stain", name: "Stain" },
  { code: "thin_spot", name: "Thin spot on glove body" },
];

function module(key: string, title: string, extra: { include?: boolean; labels?: Record<string, string>; config?: object } = {}) {
  return { key, include: extra.include ?? true, title, labels: extra.labels ?? {}, config: extra.config ?? {} };
}

/** A resolved template (templates.resolved) with modules that record different parts of a target. */
function resolvedTemplate() {
  return {
    format: 2,
    code: "PHOTOS_TEST",
    name: "Photos test",
    chain: ["PHOTOS_TEST"],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [
      { value: "S", label: "S" },
      { value: "M", label: "Medium" },
    ],
    modules: [
      module("header", "Preshipment Inspection"),
      module("dimensions", "Dimensions"),
      module("watertight", "Watertight Test", { labels: { hole_palm: "Palm" }, config: { handSplit: true } }),
      module("visual", "Visual Inspection", {
        labels: { thin_spot: "Thin spot", "minor.bead_defective": "Defective beads", critical: "Critical" },
      }),
      module("dispensing_packing", "Glove Dispensing & Packing"),
      module("labeling", "Labelling", { include: false, labels: { innerLevel: "Plastic pack" } }),
      module("documents", "Documents", {
        labels: { iso13485: "ISO 13485 certificate" },
        config: {
          items: [
            { key: "iso13485", include: true, required: true },
            { key: "fdaCe", include: false, required: false },
            { key: "certificateOfAnalysis", include: true, required: false },
          ],
        },
      }),
      module("loading", "Loading", { labels: { doorsClosed: "Doors shut" } }),
      module("conclusion", "Conclusion"),
    ],
    customModules: [
      {
        key: "pallet_check",
        title: "Pallet check",
        after: "dimensions",
        layout: "fields",
        fields: [{ key: "pallets", label: "Pallets", type: "number" }],
      },
    ],
    report: { title: "Preshipment Inspection", showClientLogo: false },
    sourceFile: null,
  };
}

const options = tagOptionsFromTemplate(resolvedTemplate(), {}, DEFECTS);

function photoRow(patch: Partial<PhotoRow> = {}): PhotoRow {
  return {
    id: PHOTO,
    inspection_id: INSPECTION,
    module_key: "dimensions",
    target: "size:M",
    storage_path: `${INSPECTION}/${PHOTO}.jpg`,
    thumb_path: `${INSPECTION}/thumbs/${PHOTO}.jpg`,
    caption: "Cuff edge",
    taken_at: "2026-10-06T09:14:03+08:00",
    width: 2048,
    height: 1536,
    flagged: false,
    include_in_report: false,
    created_by: ADMIN,
    created_at: "2026-10-06T01:14:05.123456+00:00",
    ...patch,
  };
}

describe("the test template", () => {
  it("is a resolved template, so the options below come from the real path", () => {
    expect(ResolvedTemplateSchema.safeParse(resolvedTemplate()).success).toBe(true);
  });
});

describe("rows as the screens show them", () => {
  it("previews a photo by its thumbnail", () => {
    expect(previewPath({ storage_path: "a/b.jpg", thumb_path: "a/thumbs/b.jpg" })).toBe("a/thumbs/b.jpg");
  });

  it("previews a flagged original only where a browser can show it", () => {
    expect(previewPath({ storage_path: "a/b.png", thumb_path: null })).toBe("a/b.png");
    expect(previewPath({ storage_path: "a/b.WEBP", thumb_path: null })).toBe("a/b.WEBP");
    expect(previewPath({ storage_path: "a/b.heic", thumb_path: null })).toBeNull();
  });

  it("signs every full photo and every preview once", () => {
    const flagged = photoRow({ id: "x", storage_path: `${INSPECTION}/x.heic`, thumb_path: null });
    expect(photoObjectPaths([photoRow(), photoRow(), flagged])).toEqual([
      `${INSPECTION}/${PHOTO}.jpg`,
      `${INSPECTION}/thumbs/${PHOTO}.jpg`,
      `${INSPECTION}/x.heic`,
    ]);
  });

  it("maps a row with its signed URLs, blank tags read as none", () => {
    const urls = new Map([
      [`${INSPECTION}/${PHOTO}.jpg`, "https://signed/full"],
      [`${INSPECTION}/thumbs/${PHOTO}.jpg`, "https://signed/thumb"],
    ]);
    expect(toMediaPhoto(photoRow({ module_key: " ", target: "", caption: "  " }), urls)).toMatchObject({
      id: PHOTO,
      moduleKey: null,
      target: null,
      caption: null,
      thumbUrl: "https://signed/thumb",
      fullUrl: "https://signed/full",
      includeInReport: false,
      createdBy: ADMIN,
    });
  });

  it("leaves URLs out that could not be signed", () => {
    expect(toMediaPhoto(photoRow(), new Map())).toMatchObject({ thumbUrl: null, fullUrl: null });
    const file = toMediaFile(
      {
        id: PHOTO,
        inspection_id: INSPECTION,
        module_key: "tensile",
        kind: "lab_report",
        storage_path: `${INSPECTION}/${PHOTO}.pdf`,
        name: "Tensile report.pdf",
        created_by: ADMIN,
        created_at: "2026-10-06T01:14:05.123456+00:00",
      },
      new Map(),
    );
    expect(file).toMatchObject({ moduleKey: "tensile", kind: "lab_report", name: "Tensile report.pdf", url: null });
  });
});

describe("readOnlyReason", () => {
  const owner = { canEdit: true, isAdmin: false };
  const reader = { canEdit: false, isAdmin: false };

  it("says nothing while the photos can change", () => {
    expect(readOnlyReason("draft", owner)).toBeNull();
    expect(readOnlyReason("submitted", { canEdit: true, isAdmin: true })).toBeNull();
  });

  it("explains a submitted or approved inspection, and what an admin can still do", () => {
    expect(readOnlyReason("submitted", reader)).toMatch(/submitted.*An admin can reopen it/);
    expect(readOnlyReason("approved", reader)).toBe("This inspection is approved, so its photos and files are final.");
    expect(readOnlyReason("approved", { canEdit: false, isAdmin: true })).toMatch(/choose which photos go into the report/);
    expect(readOnlyReason("draft", reader)).toBe("You can view these photos and files, but not change them.");
  });
});

describe("tag options from the template", () => {
  it("lists modules in screen order, a custom module after its module, switched-off ones last", () => {
    expect(options.modules.map(({ key, included }) => [key, included])).toEqual([
      ["header", true],
      ["dimensions", true],
      ["pallet_check", true],
      ["watertight", true],
      ["visual", true],
      ["dispensing_packing", true],
      ["documents", true],
      ["loading", true],
      ["conclusion", true],
      ["labeling", false],
    ]);
  });

  it("words labelling's levels and lists the entries of documents and loading, in the template's order and words", () => {
    // Labelling is switched off in the template: its photos keep their words all the same.
    expect(options.levels?.labeling).toEqual([
      { value: "inner", label: "Plastic pack" },
      { value: "carton", label: "Carton Box" },
    ]);
    expect(options.items?.documents).toEqual([
      { value: "iso13485", label: "ISO 13485 certificate" },
      { value: "certificateOfAnalysis", label: "Certificate of analysis" },
    ]);
    expect(options.items?.loading?.map((choice) => choice.label)).toEqual([
      "Empty container",
      "Half loaded",
      "Fully loaded",
      "Doors shut",
      "Sealed",
    ]);
    expect(options.items?.visual).toBeUndefined();
  });

  it("knows what each module records, and where hands are split", () => {
    const byKey = Object.fromEntries(options.modules.map((entry) => [entry.key, entry]));
    expect(byKey.header.targetKeys).toEqual([]);
    expect(byKey.dimensions.targetKeys).toEqual(["size"]);
    expect(byKey.pallet_check.targetKeys).toEqual(["size"]);
    expect(byKey.watertight).toMatchObject({ targetKeys: ["size", "hand", "defect"], handSplit: true });
    expect(byKey.visual).toMatchObject({ targetKeys: ["size", "hand", "defect"], handSplit: false });
    expect(byKey.dispensing_packing.targetKeys).toEqual(["size", "box"]);
  });

  it("takes the sizes with their labels and each module's defect wording", () => {
    expect(options.sizes).toEqual([
      { value: "S", label: "S" },
      { value: "M", label: "Medium" },
    ]);
    // A class-specific label (minor.bead_defective) stands in when the module has no plain one.
    expect(options.defectLabels.visual).toEqual({ thin_spot: "Thin spot", bead_defective: "Defective beads" });
    expect(options.defectLabels.watertight).toEqual({ hole_palm: "Palm" });
    expect(options.defects).toBe(DEFECTS);
  });

  it("moves a module an admin switched off for this inspection among the switched-off ones, in template order", () => {
    const overrides = { visual: { reason: "Not requested", by: ADMIN, at: "2026-10-06T10:00:00+08:00" } };
    const switched = tagOptionsFromTemplate(resolvedTemplate(), overrides, DEFECTS);
    expect(switched.modules.map(({ key, included }) => [key, included]).slice(-3)).toEqual([
      ["conclusion", true],
      ["visual", false],
      ["labeling", false],
    ]);
    // Its photos keep their names and its defects their wording.
    expect(switched.defectLabels.visual).toEqual(options.defectLabels.visual);
  });

  it("falls back to no modules or sizes, and keeps the defects, when the template does not parse", () => {
    expect(tagOptionsFromTemplate({ format: 1 }, null, DEFECTS)).toEqual({ ...EMPTY_TAG_OPTIONS, defects: DEFECTS });
  });
});

describe("names", () => {
  it("names modules by the template's title, else by their key", () => {
    expect(moduleTitle("visual", options)).toBe("Visual Inspection");
    expect(moduleTitle("dye_leak", options)).toBe("Dye leak");
    expect(moduleTitle(null, options)).toBe(UNTAGGED_TITLE);
    expect(humanizeKey("dispensing_safedon")).toBe("Dispensing safedon");
  });

  it("describes a module the template does not know as switched off, recording what its kind records", () => {
    expect(moduleOption("labeling", options)).toMatchObject({ included: false, title: "Labelling" });
    expect(moduleOption("dye_leak", options)).toEqual({
      key: "dye_leak",
      title: "Dye leak",
      targetKeys: ["size"],
      handSplit: false,
      included: false,
    });
    expect(moduleOption(null, options)).toBeNull();
  });

  it("names defects in the module's wording, else the master list's, else as stored", () => {
    expect(defectName("visual", "thin_spot", options)).toBe("Thin spot");
    expect(defectName("dimensions", "thin_spot", options)).toBe("Thin spot on glove body");
    expect(defectName("visual", "Glove torn at the cuff", options)).toBe("Glove torn at the cuff");
  });

  it("counts photos and files in words", () => {
    expect([countPhotos(0), countPhotos(1), countPhotos(3)]).toEqual(["0 photos", "1 photo", "3 photos"]);
    expect([countFiles(1), countFiles(2)]).toEqual(["1 file", "2 files"]);
  });
});

describe("defectChoices", () => {
  it("offers the module's own defects first, by its wording, then the rest of the master list", () => {
    expect(defectChoices("visual", "", options)).toEqual({
      oneOff: null,
      groups: [
        {
          key: "module",
          items: [
            { value: "bead_defective", label: "Defective beads" },
            { value: "thin_spot", label: "Thin spot" },
          ],
        },
        {
          key: "other",
          items: [
            { value: "hole_palm", label: "Hole in palm" },
            { value: "stain", label: "Stain" },
          ],
        },
      ],
    });
  });

  it("is one list where the module words no defects", () => {
    const choices = defectChoices("dimensions", "stain", options);
    expect(choices.oneOff).toBeNull();
    expect(choices.groups.map((group) => group.key)).toEqual(["other"]);
    expect(choices.groups[0].items).toHaveLength(DEFECTS.length);
  });

  it("keeps a one-off label the master list does not have", () => {
    expect(defectChoices("visual", "Glove torn at the cuff", options).oneOff).toEqual({
      value: "Glove torn at the cuff",
      label: "Glove torn at the cuff",
    });
  });
});

describe("displayTags", () => {
  it("names the module and the focus in words", () => {
    expect(displayTags("visual", "size:M/hand:R/defect:thin_spot", options)).toEqual({
      module: "Visual Inspection",
      size: "M",
      hand: "R",
      defect: "Thin spot",
      box: undefined,
    });
    expect(displayTags("dispensing_packing", "size:S/box:253", options)).toMatchObject({ size: "S", box: "253" });
  });

  it("words the packaging level and the item last, in the template's words", () => {
    expect(displayTags("labeling", "size:M/defect:lot_no/box:253/level:inner", options)).toMatchObject({
      module: "Labelling",
      size: "M",
      box: "253",
      item: "Plastic pack",
    });
    expect(displayTags("loading", "item:doorsClosed", options, { withModule: false })).toEqual({
      module: "",
      item: "Doors shut",
    });
    // A document the checklist leaves out, in the module's own words; an unknown one by its key in words.
    expect(displayTags("documents", "item:declarationOfOrigin", options).item).toBe("Declaration of origin");
    expect(itemName("documents", "fdaCe", options)).toBe("FDA / CE certificates");
    expect(itemName("documents", "millCertificate", options)).toBe("Mill certificate");
    expect(levelName("dimensions", "inner", options)).toBe("Inner Unit");
    expect(levelName("labeling", "carton", EMPTY_TAG_OPTIONS)).toBe("Carton");
  });

  it("leaves the module out under the module's own heading, unless nothing else is tagged", () => {
    expect(displayTags("visual", "size:M", options, { withModule: false }).module).toBe("");
    expect(displayTags("visual", null, options, { withModule: false }).module).toBe("Visual Inspection");
  });

  it("shows a target it cannot read as the module alone", () => {
    expect(displayTags("visual", "size:M/size:L", options)).toEqual({
      module: "Visual Inspection",
      size: undefined,
      hand: undefined,
      defect: undefined,
      box: undefined,
    });
  });
});

describe("targetForModule", () => {
  const everything = { size: "M", hand: "L" as const, defect: "stain", box: 12, level: "carton" as const, item: "sealed" };

  it("keeps only what the module records", () => {
    expect(targetForModule("dimensions", everything)).toEqual({ size: "M" });
    expect(targetForModule("dispensing_packing", everything)).toEqual({ size: "M", box: 12 });
    expect(targetForModule("visual", everything)).toEqual({ size: "M", hand: "L", defect: "stain" });
    expect(targetForModule("labeling", everything)).toEqual({ size: "M", defect: "stain", box: 12, level: "carton" });
    expect(targetForModule("loading", everything)).toEqual({ item: "sealed" });
    expect(targetForModule("header", everything)).toEqual({});
    expect(targetForModule("pallet_check", everything)).toEqual({ size: "M" });
    expect(targetForModule(null, everything)).toEqual({});
  });

  it("reads the module's target keys, custom modules repeating per size at most", () => {
    expect(targetKeysFor(null)).toEqual([]);
    expect(targetKeysFor("weight")).toEqual(["size"]);
    expect(targetKeysFor("my_extra_checks")).toEqual(["size"]);
  });
});

describe("groupByModule", () => {
  type Item = { id: string; moduleKey: string | null };
  const item = (id: string, moduleKey: string | null): Item => ({ id, moduleKey });

  it("groups in screen order: included, switched off, unknown by name, then untagged", () => {
    const groups = groupByModule(
      [
        item("1", null),
        item("2", "visual"),
        item("3", "zeta_extra"),
        item("4", "labeling"),
        item("5", "dimensions"),
        item("6", "alpha_extra"),
        item("7", "visual"),
      ],
      options,
    );
    expect(groups.map(({ key, title, included, items }) => [key, title, included, items.map((entry) => entry.id)])).toEqual([
      ["dimensions", "Dimensions", true, ["5"]],
      ["visual", "Visual Inspection", true, ["2", "7"]],
      ["labeling", "Labelling", false, ["4"]],
      ["alpha_extra", "Alpha extra", false, ["6"]],
      ["zeta_extra", "Zeta extra", false, ["3"]],
      [null, UNTAGGED_TITLE, true, ["1"]],
    ]);
  });

  it("shows no empty groups", () => {
    expect(groupByModule([], options)).toEqual([]);
  });

  it("still groups without a template", () => {
    const bare: PhotoTagOptions = EMPTY_TAG_OPTIONS;
    expect(groupByModule([item("1", "visual")], bare)).toEqual([
      { key: "visual", title: "Visual", included: false, items: [item("1", "visual")] },
    ]);
  });
});
