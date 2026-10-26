import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import { FILE_TYPES, PHOTO_TYPES, extensionFor, filePath, photoPath, storageInspectionId, thumbPath } from "./paths";
import { MODULE_TARGET_KEYS, autoTag, buildTarget, parseTarget, type PhotoTarget } from "./target";

const INSPECTION = "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10";
const PHOTO = "9d3c1a52-7e8f-4a6b-b1c2-d3e4f5a6b7c8";

describe("target strings", () => {
  it("builds the documented format, keys always in the same order", () => {
    expect(buildTarget({ box: 253, defect: "thin_spot", hand: "R", size: "M" })).toBe(
      "size:M/hand:R/defect:thin_spot/box:253",
    );
    expect(buildTarget({ size: "7.0" })).toBe("size:7.0");
    expect(buildTarget({})).toBeNull();
  });

  it("lists the packaging level and the item last, so older targets read the same", () => {
    expect(buildTarget({ level: "carton", box: 253, defect: "lot_no", size: "M" })).toBe(
      "size:M/defect:lot_no/box:253/level:carton",
    );
    expect(buildTarget({ item: "doorsClosed" })).toBe("item:doorsClosed");
  });

  it("encodes values that hold the separators, such as one-off defect labels", () => {
    expect(buildTarget({ defect: "Small dirt / stain: cuff" })).toBe("defect:Small%20dirt%20%2F%20stain%3A%20cuff");
    expect(parseTarget("defect:Small%20dirt%20%2F%20stain%3A%20cuff")).toEqual({
      ok: true,
      target: { defect: "Small dirt / stain: cuff" },
    });
  });

  it.each<PhotoTarget>([
    {},
    { size: "M" },
    { size: "XL", box: 12 },
    { size: "6.5", hand: "L", defect: "hole_crotch" },
    { size: "S", hand: "R", defect: "Thin ring between fingers (crotch)", box: 4999 },
    { defect: "Kotoran / noda" },
    { size: "L", box: 12, defect: "artwork", level: "inner" },
    { item: "certificateOfAnalysis" },
  ])("round-trips %o", (target) => {
    expect(parseTarget(buildTarget(target))).toEqual({ ok: true, target });
  });

  it("reads keys in any order, and blank as empty", () => {
    expect(parseTarget("box:253/size:M")).toEqual({ ok: true, target: { size: "M", box: 253 } });
    expect(parseTarget(null)).toEqual({ ok: true, target: {} });
    expect(parseTarget("  ")).toEqual({ ok: true, target: {} });
  });

  it.each([
    ["size", /not key:value/],
    ["colour:blue", /Unknown target key "colour"/],
    ["size:M/size:L", /"size" appears twice/],
    ["defect:%E0%A4%A", /malformed/],
    ["hand:X", /hand/],
    ["box:0", /box/],
    ["box:12a", /box/],
    ["size:", /size/],
    ["level:pallet", /level/],
    ["item:doors%20closed", /item/],
  ])("rejects %s", (text, error) => {
    const parsed = parseTarget(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(error);
  });

  it("refuses to build an invalid target", () => {
    expect(() => buildTarget({ box: 1.5 })).toThrow();
    expect(() => buildTarget({ hand: "X" as "R" })).toThrow();
  });
});

describe("autoTag", () => {
  const focus = { size: "M", hand: "R" as const, defect: "thin_spot", box: 253 };

  it("records what is in focus where it matters to the module", () => {
    expect(autoTag({ moduleKey: "visual", ...focus })).toEqual({
      moduleKey: "visual",
      target: { size: "M", hand: "R", defect: "thin_spot" },
    });
    expect(autoTag({ moduleKey: "dispensing_packing", ...focus })).toEqual({
      moduleKey: "dispensing_packing",
      target: { size: "M", box: 253 },
    });
    expect(autoTag({ moduleKey: "dimensions", ...focus })).toEqual({ moduleKey: "dimensions", target: { size: "M" } });
    expect(autoTag({ moduleKey: "header", ...focus })).toEqual({ moduleKey: "header", target: {} });
  });

  it("records labelling's packaging level and the item of documents and loading", () => {
    expect(autoTag({ moduleKey: "labeling", ...focus, level: "carton" })).toEqual({
      moduleKey: "labeling",
      target: { size: "M", defect: "thin_spot", box: 253, level: "carton" },
    });
    expect(autoTag({ moduleKey: "documents", ...focus, item: "iso13485" })).toEqual({
      moduleKey: "documents",
      target: { item: "iso13485" },
    });
    expect(autoTag({ moduleKey: "loading", size: "M", item: "doorsClosed", level: "inner" })).toEqual({
      moduleKey: "loading",
      target: { item: "doorsClosed" },
    });
    // An item does not follow the inspector into a module without a list of its own.
    expect(autoTag({ moduleKey: "dimensions", size: "M", item: "doorsClosed" })).toEqual({
      moduleKey: "dimensions",
      target: { size: "M" },
    });
  });

  it("tags a custom module with the size only", () => {
    expect(autoTag({ moduleKey: "client_seal_check", ...focus })).toEqual({
      moduleKey: "client_seal_check",
      target: { size: "M" },
    });
  });

  it("leaves out empty or invalid focus values instead of failing the photo", () => {
    expect(autoTag({ moduleKey: "watertight", size: "", hand: null, defect: "hole_palm", box: 7 })).toEqual({
      moduleKey: "watertight",
      target: { defect: "hole_palm" },
    });
    expect(autoTag({ moduleKey: "labeling", size: "L", box: 0 })).toEqual({ moduleKey: "labeling", target: { size: "L" } });
  });

  it("has a rule for every module", () => {
    expect(Object.keys(MODULE_TARGET_KEYS).sort()).toEqual([...MODULE_KEYS].sort());
  });
});

describe("storage paths", () => {
  // paths.db.test.ts checks these names, and storageInspectionId, against the database's own function.
  it("names photos, thumbnails and files inside the inspection's folder, as the policies require", () => {
    const names = [photoPath(INSPECTION, PHOTO), photoPath(INSPECTION, PHOTO, "heic"), thumbPath(INSPECTION, PHOTO), filePath(INSPECTION, PHOTO, "pdf")];
    expect(names).toEqual([
      `${INSPECTION}/${PHOTO}.jpg`,
      `${INSPECTION}/${PHOTO}.heic`,
      `${INSPECTION}/thumbs/${PHOTO}.jpg`,
      `${INSPECTION}/${PHOTO}.pdf`,
    ]);
    for (const name of names) expect(storageInspectionId(name)).toBe(INSPECTION);
  });

  it("refuses ids and extensions that would escape the folder rule", () => {
    expect(() => photoPath(INSPECTION.toUpperCase(), PHOTO)).toThrow(/lowercase UUID/);
    expect(() => photoPath(INSPECTION, "../other")).toThrow(/UUID/);
    expect(() => filePath(INSPECTION, PHOTO, "p/df")).toThrow(/extension/);
    expect(() => filePath(INSPECTION, PHOTO, "")).toThrow(/extension/);
  });

  it("reads names the way the database does", () => {
    expect(storageInspectionId(`${INSPECTION}/../${PHOTO}/x.jpg`)).toBeNull();
    expect(storageInspectionId(`${INSPECTION}/./x.jpg`)).toBeNull();
    expect(storageInspectionId("not-an-inspection/photo.jpg")).toBeNull();
    expect(storageInspectionId(`${INSPECTION}`)).toBeNull();
    expect(storageInspectionId(`${INSPECTION}/photo with space.jpg`)).toBeNull();
  });

  it("has an extension for every type the buckets accept, and none for others", () => {
    expect(FILE_TYPES.map(extensionFor)).toEqual(["pdf", "jpg", "png", "webp", "heic", "heif", "mp4", "mov", "webm", "xlsx", "xls", "csv"]);
    expect(PHOTO_TYPES.every((type) => extensionFor(type) !== null)).toBe(true);
    expect(extensionFor("image/gif")).toBeNull();
  });
});
